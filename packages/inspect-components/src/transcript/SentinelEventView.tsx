import clsx from "clsx";
import { FC, Fragment, ReactNode } from "react";

import type {
  SentinelEvent,
  SentinelRemote,
  ToolCall,
} from "@tsmono/inspect-common/types";
import { resolveToolInput } from "@tsmono/inspect-components/chat";
import {
  CopyButton,
  MarkdownDivWithReferences,
} from "@tsmono/react/components";
import { useCollapsedState, useProperty } from "@tsmono/react/hooks";
import { Icon, IconName } from "@tsmono/react/icons";
import { formatDateTime } from "@tsmono/util";

import { fmtInstant, fmtShortDuration } from "../usage/timeFormat";

import { citeReferences, type MakeCiteUrl } from "./citeReferences";
import { EventRow } from "./event/EventRow";
import { ModelEventView } from "./ModelEventView";
import styles from "./SentinelEventView.module.css";
import {
  checkClasses,
  CheckInset,
  CheckSummary,
  ReplacedCall,
  sameArguments,
  type CheckRegion,
  type CheckTone,
} from "./ToolCheckInset";
import {
  buildLoneSentinelStep,
  isUnknownStatusVerdict,
  sentinelStageLabels,
  sortedScores,
  topScore,
  unjudgedReasonText,
  type KnownSentinelVerdict,
  type SentinelRow,
  type SentinelStep,
} from "./transform/toolSentinels";
import type { EventNode, EventNodeContext } from "./types";

interface SentinelInsetProps {
  step: SentinelStep;
  /** The tool block region the inset sits in; before-call checks go in the input. */
  region: CheckRegion;
  /** The host row's context; monitor model calls take only its retry attempts. */
  context?: EventNodeContext;
  /** The call the step judged, which a modify that took effect shows struck through; unset when unknown. */
  judged?: ToolCall;
  /** Whether the judged call is an approver's replacement rather than the model's proposal. */
  judgedReplaced?: boolean;
  /** False where the step's time is already in the title around the inset. */
  showTime?: boolean;
}

/**
 * One step's sentinel checks: a summary row naming the result that took
 * effect, expanding to the tree of every check (or a lone check's detail).
 */
export const SentinelInset: FC<SentinelInsetProps> = ({
  step,
  region,
  context,
  judged,
  judgedReplaced,
  showTime = true,
}) => {
  const [collapsed, setCollapsed] = useCollapsedState(
    `${step.id}-sentinel-checks`,
    true
  );
  const look = lookOf(step);
  const tone: CheckTone = step.effective ? look.tone : "neutral";
  const single = step.rows.length === 1 ? step.rows[0] : undefined;
  // A trimmed report is only the decision: there are no checks to expand.
  const trimmed = !!step.remote?.trimmed && step.rows.length <= 1;
  const who = (single?.node ?? step.decider)?.event.path || undefined;
  const modified = step.effective ? step.outcome?.event.modified : undefined;
  const makeCiteUrl = context?.makeCiteUrl;
  const duration = showTime ? fmtShortDuration(step.workingTime) : undefined;
  const unjudged = step.verdict === "unjudged";
  return (
    <CheckInset region={region} tone={tone}>
      <CheckSummary
        icon={look.icon}
        iconClassName={look.iconClass}
        verdict={look.word}
        verdictClassName={look.textClass}
        badge={step.remote ? <RemoteChip remote={step.remote} /> : null}
        who={who}
        scores={step.scores}
        reason={
          unjudged && step.reason
            ? `— ${unjudgedReasonText(step.reason)}`
            : step.reason
        }
        reasonClassName={look.reasonClass}
        references={citeReferences(step.reasonReferences, makeCiteUrl)}
        error={step.error}
        flagged={step.audit}
        failed={single ? 0 : step.failed}
        clampReason={collapsed}
        time={
          duration
            ? `${unjudged ? "stopped after" : "judged in"} ${duration}`
            : undefined
        }
        timeTitle={stepTimeTitle(step)}
        toggle={
          trimmed
            ? undefined
            : {
                label: single ? "details" : `${step.rows.length} checks`,
                open: !collapsed,
                onToggle: () => setCollapsed(!collapsed),
              }
        }
      />
      {step.verdict === "modify" &&
      modified &&
      judged &&
      !sameArguments(judged.arguments, modified.arguments) ? (
        <ReplacedCall
          call={judged}
          label={judgedReplaced ? "replaced" : "proposed"}
        />
      ) : null}
      {trimmed && step.remote ? (
        <div className={clsx(styles.detail, toneDetailClass(tone))}>
          <div className={styles.noExplanation}>
            The remote sentinel sent only its decision, not its checks&apos;
            reports.
          </div>
          <Facts facts={remoteFacts(step.remote)} />
        </div>
      ) : null}
      {!trimmed && !collapsed && single ? (
        <CheckDetail
          row={single}
          showFunction={false}
          makeCiteUrl={makeCiteUrl}
        />
      ) : null}
      {!trimmed && !collapsed && !single ? (
        <CheckTree step={step} tone={tone} makeCiteUrl={makeCiteUrl} />
      ) : null}
      {step.modelCalls[0] ? (
        <ModelCallsNote
          id={step.modelCalls[0].id}
          modelCalls={step.modelCalls}
          context={context}
        />
      ) : null}
    </CheckInset>
  );
};

/** "Started …" and "Finished …" on two lines, for a step's time. */
const stepTimeTitle = (step: SentinelStep): string | undefined => {
  const lines = [
    step.started ? `Started ${fmtInstant(step.started)}` : null,
    step.completed ? `Finished ${fmtInstant(step.completed)}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
};

const RemoteChip: FC<{ remote: SentinelRemote }> = ({ remote }) => (
  <span
    className={styles.chip}
    title={[
      `Proxy ${remote.proxy_url}`,
      remote.request_id ? `x-irid ${remote.request_id}` : null,
    ]
      .filter(Boolean)
      .join("\n")}
  >
    remote
  </span>
);

/** The span of a step's checks, where every check recorded when it started and finished. */
interface Timeline {
  start: number;
  span: number;
}

/**
 * Bars need every check's own times. A remote step's events carry the time
 * Inspect wrote them, not when each check ran (inspect_sentinel#229), so
 * they get durations only.
 */
const timelineOf = (step: SentinelStep): Timeline | undefined => {
  if (step.remote || step.rows.some((r) => r.node.event.remote)) {
    return undefined;
  }
  let start = Infinity;
  let end = -Infinity;
  for (const { node } of step.rows) {
    const from = Date.parse(node.event.timestamp);
    const to = node.event.completed ? Date.parse(node.event.completed) : NaN;
    if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
    start = Math.min(start, from);
    end = Math.max(end, to);
  }
  const span = end - start;
  return span > 0 ? { start, span } : undefined;
};

interface CheckTreeProps {
  step: SentinelStep;
  tone: CheckTone;
  makeCiteUrl?: MakeCiteUrl;
}

const CheckTree: FC<CheckTreeProps> = ({ step, tone, makeCiteUrl }) => {
  const grouped = groupedPaths(step.rows);
  const timeline = timelineOf(step);
  const [openRow, setOpenRow] = useProperty<string | null>(
    step.id,
    "sentinel-open-row",
    { defaultValue: step.effective?.id ?? null }
  );
  return (
    <div
      className={clsx(
        styles.tree,
        timeline && styles.timed,
        tone === "reject" && styles.reject,
        tone === "modify" && styles.modify
      )}
    >
      {step.rows.map((row) => {
        const showFunction = grouped.has(row.node.event.path);
        const expandable = hasDetail(row, showFunction);
        const open = expandable && openRow === row.node.id;
        return (
          <Fragment key={row.node.id}>
            <CheckRowView
              row={row}
              open={open}
              timeline={timeline}
              onToggle={
                expandable
                  ? () => setOpenRow(open ? null : row.node.id)
                  : undefined
              }
            />
            {open ? (
              <CheckDetail
                row={row}
                showFunction={showFunction}
                makeCiteUrl={makeCiteUrl}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
};

/**
 * Whether a row's detail would add to the row. A reported check always opens,
 * to its explanation or the note that it gave none; a check that reported
 * nothing opens only to what it recorded besides its times and provenance,
 * which the row and the step's summary already show.
 */
const hasDetail = (row: SentinelRow, showFunction: boolean): boolean => {
  const event = row.node.event;
  return (
    event.status === "reported" ||
    event.status === "superseded" ||
    showFunction ||
    !!event.explanation?.trim() ||
    !!event.error ||
    !!event.message ||
    !!event.modified ||
    event.audit
  );
};

interface CheckRowViewProps {
  row: SentinelRow;
  open: boolean;
  /** The step's span, which places the row's bar; unset where the row shows its duration alone. */
  timeline?: Timeline;
  /** Unset for a row with no detail to open. */
  onToggle?: () => void;
}

const CheckRowView: FC<CheckRowViewProps> = ({
  row,
  open,
  timeline,
  onToggle,
}) => {
  const event = row.node.event;
  const cells = (
    <>
      <span className={styles.rowLabel}>
        {row.guides ? (
          <span className={styles.guides}>{row.guides}</span>
        ) : null}
        <Icon
          name={event.kind === "observation" ? "activity" : "signpost"}
          className={styles.kindIcon}
        />
        <b>{event.path || "(top)"}</b>{" "}
        <span className={styles.name}>{event.factory}</span>
      </span>
      {timeline ? <TimeBar event={event} timeline={timeline} /> : null}
      <span className={styles.time}>
        {fmtShortDuration(event.working_time)}
      </span>
      <span className={styles.result}>
        <CheckResult row={row} />
      </span>
      <span className={styles.rowChevron}>
        {onToggle ? (
          <Icon name={open ? "chevronDown" : "chevronRight"} />
        ) : null}
      </span>
    </>
  );
  const className = clsx(
    styles.row,
    open && styles.open,
    isInactive(event) && styles.inactive
  );
  return onToggle ? (
    <button
      type="button"
      aria-expanded={open}
      className={clsx(className, styles.toggles)}
      onClick={onToggle}
    >
      {cells}
    </button>
  ) : (
    <div className={className}>{cells}</div>
  );
};

const TimeBar: FC<{ event: SentinelEvent; timeline: Timeline }> = ({
  event,
  timeline,
}) => {
  const from = Date.parse(event.timestamp) - timeline.start;
  const to =
    (event.completed ? Date.parse(event.completed) : NaN) - timeline.start;
  const left = (from / timeline.span) * 100;
  const width = ((to - from) / timeline.span) * 100;
  return (
    <span
      className={styles.track}
      title={`+${fmtShortDuration(from / 1000)} → +${fmtShortDuration(to / 1000)}`}
    >
      <span
        className={styles.bar}
        style={{ left: `${left}%`, width: `max(3px, ${width}%)` }}
      />
    </span>
  );
};

const CheckResult: FC<{ row: SentinelRow }> = ({ row }) => {
  const event = row.node.event;
  const flag = event.audit ? (
    <Icon
      name="flag"
      className={styles.flag}
      role="img"
      aria-hidden={false}
      aria-label="flagged"
    />
  ) : null;
  if (event.status === "bypassed" || event.status === "cancelled") {
    return <span>{event.status}</span>;
  }
  if (event.status === "unjudged") {
    return <span>not judged</span>;
  }
  if (event.status === "error") {
    return <span className={styles.failed}>failed</span>;
  }
  if (event.status === "superseded") {
    return (
      <span>
        <s>{event.action}</s> · superseded
      </span>
    );
  }
  if (event.status !== "reported") {
    return <span>{event.status}</span>;
  }
  if (event.suspicion !== undefined && event.suspicion !== null) {
    const top = topScore(event.suspicion);
    return (
      <>
        {flag}
        <span>
          {top.dimension ? `${top.dimension} ` : ""}
          {top.value}
        </span>
        {top.more > 0 ? (
          <span className={styles.chip}>
            {top.more === 1 ? "1 more score" : `${top.more} more scores`}
          </span>
        ) : null}
      </>
    );
  }
  if (!event.action) return flag;
  return (
    <>
      {flag}
      <span className={decisionClass(event.action)}>{event.action}</span>
    </>
  );
};

interface Fact {
  label: string;
  value: ReactNode;
}

/** Labelled rows in one aligned table, each left out when it has no value. */
const Facts: FC<{ facts: (Fact | null)[] }> = ({ facts }) => {
  const shown = facts.filter((fact): fact is Fact => fact !== null);
  if (shown.length === 0) return null;
  return (
    <div className={styles.facts}>
      {shown.map(({ label, value }) => (
        <Fragment key={label}>
          <span className={clsx(checkClasses.label, styles.factLabel)}>
            {label}
          </span>
          <span className={styles.factValue}>{value}</span>
        </Fragment>
      ))}
    </div>
  );
};

const remoteFacts = (remote: SentinelRemote): (Fact | null)[] => [
  {
    label: "Remote",
    value: <span className={checkClasses.mono}>{remote.proxy_url}</span>,
  },
  remote.request_id
    ? {
        label: "Request",
        value: (
          <>
            <span className={checkClasses.mono}>{remote.request_id}</span>
            <CopyButton
              value={remote.request_id}
              className={styles.copy}
              ariaLabel="Copy request id"
            />
          </>
        ),
      }
    : null,
];

interface CheckDetailProps {
  row: SentinelRow;
  /** Names the reporting function, for an instance that reported from several. */
  showFunction: boolean;
  makeCiteUrl?: MakeCiteUrl;
}

const CheckDetail: FC<CheckDetailProps> = ({
  row,
  showFunction,
  makeCiteUrl,
}) => {
  const event = row.node.event;
  const explanation = event.explanation?.trim();
  const effectTone = row.tookEffect ? toneOfDecision(event.action) : null;
  const status = [
    event.audit ? "flagged" : null,
    event.status === "superseded" ? "superseded" : null,
  ].filter(Boolean);
  const reportedBy = showFunction ? event.function : null;
  const scores =
    event.suspicion !== null &&
    typeof event.suspicion === "object" &&
    Object.keys(event.suspicion).length > 1
      ? sortedScores(event.suspicion)
      : undefined;
  const workingTime = fmtShortDuration(event.working_time);
  return (
    <div className={styles.detailWrap} style={{ paddingLeft: indent(row) }}>
      <div
        className={clsx(
          styles.detail,
          effectTone && toneDetailClass(effectTone),
          !effectTone && event.stage === "tool_result" && styles.afterDetail
        )}
      >
        {status.length || reportedBy ? (
          <div className={styles.meta}>
            {status.join(" · ")}
            {reportedBy ? (
              <>
                {status.length ? " · " : null}
                function:{" "}
                <span className={checkClasses.mono}>{reportedBy}</span>
              </>
            ) : null}
          </div>
        ) : null}
        {scores ? (
          <div className={styles.scoreGrid}>
            {scores.map(([dimension, value]) => (
              <Fragment key={dimension}>
                <span className={styles.scoreName}>{dimension}</span>
                <span>{Math.round(value * 100) / 100}</span>
              </Fragment>
            ))}
          </div>
        ) : null}
        {event.error ? (
          <div className={clsx(styles.errorText, checkClasses.mono)}>
            {event.error}
          </div>
        ) : explanation ? (
          <MarkdownDivWithReferences
            markdown={explanation}
            references={citeReferences(event.references, makeCiteUrl)}
            className={clsx(
              styles.explanation,
              effectTone === "reject" && checkClasses.rejectReason
            )}
          />
        ) : event.status === "reported" ? (
          <div className={styles.noExplanation}>No explanation recorded.</div>
        ) : null}
        <Facts
          facts={[
            event.message
              ? { label: "Told the agent", value: event.message }
              : null,
            event.modified
              ? {
                  label: "Modified",
                  value: (
                    <span className={checkClasses.mono}>
                      {replacementText(event.modified)}
                    </span>
                  ),
                }
              : null,
            workingTime ? { label: "Working time", value: workingTime } : null,
            // A remote check's time is when Inspect wrote it (inspect_sentinel#229).
            event.completed && !event.remote
              ? {
                  label: "Completed",
                  value: formatDateTime(new Date(event.completed)),
                }
              : null,
            ...(event.remote ? remoteFacts(event.remote) : []),
          ]}
        />
      </div>
    </div>
  );
};

const toneDetailClass = (tone: CheckTone): string | undefined =>
  tone === "reject"
    ? styles.rejectDetail
    : tone === "modify"
      ? styles.modifyDetail
      : undefined;

/** Paths of the instances that reported from more than one function on this step. */
const groupedPaths = (rows: SentinelRow[]): Set<string> => {
  const functions = new Map<string, Set<string>>();
  for (const { node } of rows) {
    if (!node.event.function) continue;
    const seen = functions.get(node.event.path) ?? new Set<string>();
    seen.add(node.event.function);
    functions.set(node.event.path, seen);
  }
  return new Set(
    [...functions].filter(([, seen]) => seen.size > 1).map(([path]) => path)
  );
};

const indent = (row: SentinelRow): string => `calc(8px + ${row.depth * 3}ch)`;

const replacementText = (call: ToolCall): string => {
  const { input, functionCall } = resolveToolInput(
    call.function,
    call.arguments
  );
  return typeof input === "string" && input ? input : functionCall;
};

const isInactive = (event: SentinelEvent): boolean =>
  event.status !== "reported";

interface ModelCallsNoteProps {
  id: string;
  modelCalls: SentinelStep["modelCalls"];
  context?: EventNodeContext;
}

/** The step's monitor model calls, collapsed to a count that expands to the model call views. */
const ModelCallsNote: FC<ModelCallsNoteProps> = ({
  id,
  modelCalls,
  context,
}) => {
  const [collapsed, setCollapsed] = useCollapsedState(
    `${id}-sentinel-model-calls`,
    true
  );
  const callContext = { retryAttempts: context?.retryAttempts };
  return (
    <div>
      <button
        type="button"
        className={clsx(styles.foldedToggle, "text-style-secondary")}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Icon
          name={collapsed ? "chevronRight" : "chevronDown"}
          className={styles.chevron}
        />
        {`${modelCalls.length} monitor model call${modelCalls.length === 1 ? "" : "s"}`}
      </button>
      {collapsed ? null : (
        <div className={styles.modelCalls}>
          {modelCalls.map((node) => (
            <ModelEventView
              key={node.id}
              eventNode={node}
              showToolCalls={true}
              context={callContext}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface SentinelStepRowProps {
  step: SentinelStep;
  context?: EventNodeContext;
  /** Enables the evidence-selection checkbox for a row of its own. */
  eventNodeId?: string;
  className?: string;
}

/** A step outside any tool panel, e.g. a model-stage step, as an event row. */
export const SentinelStepRow: FC<SentinelStepRowProps> = ({
  step,
  context,
  eventNodeId,
  className,
}) => {
  const duration = fmtShortDuration(step.workingTime);
  return (
    <EventRow
      eventNodeId={eventNodeId}
      title={
        duration ? (
          <span title={stepTimeTitle(step)}>
            Sentinel (<span className={styles.titleTime}>{duration}</span>)
          </span>
        ) : (
          "Sentinel"
        )
      }
      icon="sentinel"
      className={className}
      below={
        <SentinelInset
          step={step}
          region="output"
          context={context}
          showTime={false}
        />
      }
    >
      <span className="text-style-secondary">
        {sentinelStageLabels[step.stage]}
      </span>
    </EventRow>
  );
};

interface SentinelEventViewProps {
  eventNode: EventNode<SentinelEvent>;
  /** The step this event hosts; without one the event renders alone. */
  step?: SentinelStep;
  context?: EventNodeContext;
  className?: string;
}

/** A sentinel step outside any tool panel, e.g. a model-stage step. */
export const SentinelEventView: FC<SentinelEventViewProps> = ({
  eventNode,
  step,
  context,
  className,
}) => (
  <SentinelStepRow
    step={step ?? buildLoneSentinelStep(eventNode)}
    eventNodeId={eventNode.id}
    context={context}
    className={className}
  />
);

interface VerdictLook {
  icon: IconName;
  word: string;
  tone: CheckTone;
  iconClass?: string;
  textClass?: string;
  reasonClass?: string;
}

const rejectLook = {
  icon: "sentinelFill",
  tone: "reject",
  iconClass: checkClasses.rejectIcon,
  textClass: checkClasses.rejectText,
  reasonClass: checkClasses.rejectReason,
} as const;

const verdictLooks: Record<KnownSentinelVerdict, VerdictLook> = {
  proceed: {
    icon: "sentinel",
    word: "Proceeded",
    tone: "neutral",
  },
  observe: {
    icon: "sentinel",
    word: "Observed",
    tone: "neutral",
  },
  bypassed: {
    icon: "sentinel",
    word: "Bypassed",
    tone: "neutral",
  },
  cancelled: {
    icon: "sentinel",
    word: "Cancelled",
    tone: "neutral",
  },
  unjudged: {
    icon: "sentinel",
    word: "Not judged",
    tone: "neutral",
  },
  superseded: {
    icon: "sentinel",
    word: "Superseded",
    tone: "neutral",
  },
  error: {
    icon: "warning",
    word: "Failed",
    tone: "neutral",
    textClass: styles.failed,
  },
  reject: { ...rejectLook, word: "Rejected" },
  terminate: { ...rejectLook, word: "Terminated" },
  modify: {
    icon: "sentinelFill",
    word: "Modified",
    tone: "modify",
    iconClass: checkClasses.modifyIcon,
    textClass: checkClasses.modifyText,
  },
  escalate: {
    icon: "approvalEscalate",
    word: "Escalated",
    tone: "modify",
    iconClass: checkClasses.modifyIcon,
    textClass: checkClasses.modifyText,
  },
};

/** An escalate the runner returned had no handler above it, so the call proceeded. */
const unhandledEscalateLook: VerdictLook = {
  icon: "approvalEscalate",
  word: "Escalated (no handler; proceeded)",
  tone: "neutral",
};

/** A status a later Inspect adds records no report, so it reads as one. */
const unknownStatusLook = (status: string): VerdictLook => ({
  icon: "sentinel",
  word: status,
  tone: "neutral",
});

const lookOf = ({ verdict, returned }: SentinelStep): VerdictLook => {
  if (isUnknownStatusVerdict(verdict)) {
    return unknownStatusLook(verdict.slice("status:".length));
  }
  return verdict === "escalate" && returned
    ? unhandledEscalateLook
    : verdictLooks[verdict];
};

const toneOfDecision = (
  decision: SentinelEvent["action"] | undefined
): CheckTone | null => {
  switch (decision) {
    case "reject":
    case "terminate":
      return "reject";
    case "modify":
    case "escalate":
      return "modify";
    default:
      return null;
  }
};

const decisionClass = (
  decision: NonNullable<SentinelEvent["action"]>
): string | undefined => {
  switch (decision) {
    case "reject":
    case "terminate":
      return checkClasses.rejectText;
    case "escalate":
    case "modify":
      return checkClasses.modifyText;
    case "proceed":
      return styles.proceed;
  }
};
