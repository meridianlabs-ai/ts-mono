import clsx from "clsx";
import { FC, Fragment } from "react";

import type {
  SentinelEvent,
  SentinelSidecar,
  ToolCall,
} from "@tsmono/inspect-common/types";
import { resolveToolInput } from "@tsmono/inspect-components/chat";
import { MarkdownDivWithReferences } from "@tsmono/react/components";
import { useCollapsedState, useProperty } from "@tsmono/react/hooks";
import { Icon, IconName } from "@tsmono/react/icons";
import { formatDateTime, formatTime } from "@tsmono/util";

import { citeReferences, type MakeCiteUrl } from "./citeReferences";
import { EventRow } from "./event/EventRow";
import { formatTitle } from "./event/utils";
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
  const who = (single?.node ?? step.decider)?.event.path || undefined;
  const modified = step.effective ? step.outcome?.event.modified : undefined;
  const makeCiteUrl = context?.makeCiteUrl;
  return (
    <CheckInset region={region} tone={tone}>
      <CheckSummary
        icon={look.icon}
        iconClassName={look.iconClass}
        verdict={look.word}
        verdictClassName={look.textClass}
        who={who}
        scores={step.scores}
        reason={step.reason}
        reasonClassName={look.reasonClass}
        references={citeReferences(step.reasonReferences, makeCiteUrl)}
        error={step.error}
        flagged={step.audit}
        failed={single ? 0 : step.failed}
        clampReason={collapsed}
        time={
          showTime && step.workingTime != null
            ? formatTime(step.workingTime)
            : undefined
        }
        toggle={{
          label: single ? "details" : `${step.rows.length} checks`,
          open: !collapsed,
          onToggle: () => setCollapsed(!collapsed),
        }}
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
      {!collapsed && single ? (
        <CheckDetail
          row={single}
          showFunction={false}
          makeCiteUrl={makeCiteUrl}
        />
      ) : null}
      {!collapsed && !single ? (
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

interface CheckTreeProps {
  step: SentinelStep;
  tone: CheckTone;
  makeCiteUrl?: MakeCiteUrl;
}

const CheckTree: FC<CheckTreeProps> = ({ step, tone, makeCiteUrl }) => {
  const grouped = groupedPaths(step.rows);
  const [openRow, setOpenRow] = useProperty<string | null>(
    step.id,
    "sentinel-open-row",
    { defaultValue: step.effective?.id ?? null }
  );
  return (
    <div
      className={clsx(
        styles.tree,
        tone === "reject" && styles.reject,
        tone === "modify" && styles.modify
      )}
    >
      {step.rows.map((row) => {
        const open = openRow === row.node.id;
        return (
          <Fragment key={row.node.id}>
            <CheckRowView
              row={row}
              open={open}
              onToggle={() => setOpenRow(open ? null : row.node.id)}
            />
            {open ? (
              <CheckDetail
                row={row}
                showFunction={grouped.has(row.node.event.path)}
                makeCiteUrl={makeCiteUrl}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
};

interface CheckRowViewProps {
  row: SentinelRow;
  open: boolean;
  onToggle: () => void;
}

const CheckRowView: FC<CheckRowViewProps> = ({ row, open, onToggle }) => {
  const event = row.node.event;
  return (
    <button
      type="button"
      aria-expanded={open}
      className={clsx(
        styles.row,
        open && styles.open,
        isInactive(event) && styles.inactive
      )}
      onClick={onToggle}
    >
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
      <span className={styles.result}>
        {event.working_time != null ? (
          <span className={styles.time}>{formatTime(event.working_time)}</span>
        ) : null}
        <CheckResult row={row} />
        <Icon
          name={open ? "chevronDown" : "chevronRight"}
          className={styles.rowChevron}
        />
      </span>
    </button>
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
          <span className={styles.moreScores}>
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
  const timing = [
    event.working_time != null
      ? `working time ${formatTime(event.working_time)}`
      : null,
    event.completed
      ? `completed ${formatDateTime(new Date(event.completed))}`
      : null,
  ].filter(Boolean);
  const scores =
    event.suspicion !== null &&
    typeof event.suspicion === "object" &&
    Object.keys(event.suspicion).length > 1
      ? sortedScores(event.suspicion)
      : undefined;
  return (
    <div className={styles.detailWrap} style={{ paddingLeft: indent(row) }}>
      <div
        className={clsx(
          styles.detail,
          effectTone === "reject" && styles.rejectDetail,
          effectTone === "modify" && styles.modifyDetail,
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
        {timing.length ? (
          <div className={styles.meta}>{timing.join(" · ")}</div>
        ) : null}
        {event.sidecar ? <SidecarMeta sidecar={event.sidecar} /> : null}
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
        ) : event.status === "unjudged" ? (
          <div className={styles.noExplanation}>
            {event.reason ? `Not judged: ${event.reason}` : "Not judged."}
          </div>
        ) : (
          <div className={styles.noExplanation}>No explanation recorded.</div>
        )}
        {event.message ? (
          <div className={styles.labelled}>
            <span className={clsx(checkClasses.label, checkClasses.rejectText)}>
              told the agent
            </span>
            <span>{event.message}</span>
          </div>
        ) : null}
        {event.modified ? (
          <div className={styles.labelled}>
            <span className={clsx(checkClasses.label, checkClasses.modifyText)}>
              modified
            </span>
            <span className={checkClasses.mono}>
              {replacementText(event.modified)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const SidecarMeta: FC<{ sidecar: SentinelSidecar }> = ({ sidecar }) => (
  <div className={styles.meta}>
    sidecar
    {sidecar.request_id ? (
      <>
        {" · x-irid "}
        <span className={checkClasses.mono}>{sidecar.request_id}</span>
      </>
    ) : null}
    {sidecar.trimmed ? (
      <span title="The sidecar withheld this step's reports from the eval and sent only its decision.">
        {" · trimmed"}
      </span>
    ) : null}
  </div>
);

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
}) => (
  <EventRow
    eventNodeId={eventNodeId}
    title={formatTitle("Sentinel", undefined, step.workingTime)}
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
