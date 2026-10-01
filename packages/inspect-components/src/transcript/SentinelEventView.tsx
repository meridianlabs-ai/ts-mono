import clsx from "clsx";
import { FC, Fragment } from "react";

import type { SentinelEvent, ToolCall } from "@tsmono/inspect-common/types";
import { resolveToolInput } from "@tsmono/inspect-components/chat";
import { MarkdownDivWithReferences } from "@tsmono/react/components";
import { useCollapsedState, useProperty } from "@tsmono/react/hooks";

import { citeReferences, type MakeCiteUrl } from "./citeReferences";
import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import { ModelEventView } from "./ModelEventView";
import styles from "./SentinelEventView.module.css";
import {
  checkClasses,
  CheckInset,
  CheckSummary,
  RanInstead,
  type CheckRegion,
  type CheckTone,
} from "./ToolCheckInset";
import {
  buildLoneSentinelStep,
  sortedScores,
  topScore,
  type SentinelRow,
  type SentinelStep,
  type SentinelVerdict,
} from "./transform/toolSentinels";
import type { EventNode, EventNodeContext } from "./types";

interface SentinelInsetProps {
  step: SentinelStep;
  /** The tool block region the inset sits in; before-call checks go in the input. */
  region: CheckRegion;
  /** The host row's context; monitor model calls take only its retry attempts. */
  context?: EventNodeContext;
  /** Whether the call ran; a modify of a call that never ran shows what it proposed. */
  ran?: boolean;
}

/**
 * One step's sentinel checks: a summary row naming the result that took
 * effect, expanding to the tree of every check with its detail beneath it.
 */
export const SentinelInset: FC<SentinelInsetProps> = ({
  step,
  region,
  context,
  ran = true,
}) => {
  const [collapsed, setCollapsed] = useCollapsedState(
    `${step.id}-sentinel-checks`,
    true
  );
  const look = verdictLooks[step.verdict];
  const tone: CheckTone = step.effective ? look.tone : "neutral";
  const single = step.rows.length === 1 ? step.rows[0] : undefined;
  const who = (single?.node ?? step.decider)?.event.path || undefined;
  const modified = step.effective ? step.outcome?.event.modified : undefined;
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
        flagged={step.audit}
        checks={step.rows.length}
        open={!collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      {step.verdict === "modify" && modified ? (
        <RanInstead call={modified} ran={ran} />
      ) : null}
      {!collapsed && step.rows.length > 1 ? (
        <CheckTree step={step} tone={tone} makeCiteUrl={context?.makeCiteUrl} />
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
        <i
          className={clsx(
            event.kind === "observation"
              ? "bi bi-activity"
              : "bi bi-signpost-split",
            styles.kindIcon
          )}
          aria-hidden="true"
        />
        <b>{event.path || "(top)"}</b>{" "}
        <span className={styles.name}>{event.factory}</span>
      </span>
      <span className={styles.result}>
        <CheckResult row={row} />
        <i
          className={clsx(
            open ? "bi bi-chevron-down" : "bi bi-chevron-right",
            styles.rowChevron
          )}
        />
      </span>
    </button>
  );
};

const CheckResult: FC<{ row: SentinelRow }> = ({ row }) => {
  const event = row.node.event;
  const flag = event.audit ? (
    <i
      className={clsx("bi bi-flag-fill", styles.flag)}
      role="img"
      aria-label="flagged"
    />
  ) : null;
  if (event.kind === "bypassed" || event.kind === "cancelled") {
    return <span>{event.kind}</span>;
  }
  if (event.kind === "superseded") {
    return (
      <span>
        <s>{event.action}</s> · superseded
      </span>
    );
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
    event.kind === "superseded" ? "superseded" : null,
  ].filter(Boolean);
  const reportedBy = showFunction ? event.function : null;
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
        {explanation ? (
          <MarkdownDivWithReferences
            markdown={explanation}
            references={citeReferences(event.references, makeCiteUrl)}
            className={clsx(
              styles.explanation,
              effectTone === "reject" && checkClasses.rejectReason
            )}
          />
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
  event.kind === "superseded" ||
  event.kind === "bypassed" ||
  event.kind === "cancelled";

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
        <i
          className={clsx(
            collapsed ? "bi bi-chevron-right" : "bi bi-chevron-down",
            styles.chevron
          )}
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
    title="Sentinel"
    icon={TranscriptIcons.sentinel}
    className={className}
    below={<SentinelInset step={step} region="output" context={context} />}
  >
    <span className="text-style-secondary">{stageLabels[step.stage]}</span>
  </EventRow>
);

interface SentinelEventViewProps {
  eventNode: EventNode<SentinelEvent>;
  /** The step this event hosts; without one the event renders alone. */
  step?: SentinelStep;
  className?: string;
}

/** A sentinel step outside any tool panel, e.g. a model-stage step. */
export const SentinelEventView: FC<SentinelEventViewProps> = ({
  eventNode,
  step,
  className,
}) => (
  <SentinelStepRow
    step={step ?? buildLoneSentinelStep(eventNode)}
    eventNodeId={eventNode.id}
    className={className}
  />
);

const stageLabels: Record<SentinelEvent["stage"], string> = {
  model_input: "model input",
  model_output: "model output",
  tool_call: "before call",
  tool_result: "after call",
};

interface VerdictLook {
  icon: string;
  word: string;
  tone: CheckTone;
  iconClass?: string;
  textClass?: string;
  reasonClass?: string;
}

const rejectLook = {
  icon: "bi bi-binoculars-fill",
  tone: "reject",
  iconClass: checkClasses.rejectIcon,
  textClass: checkClasses.rejectText,
  reasonClass: checkClasses.rejectReason,
} as const;

const verdictLooks: Record<SentinelVerdict, VerdictLook> = {
  continue: {
    icon: TranscriptIcons.sentinel,
    word: "Continued",
    tone: "neutral",
  },
  observe: {
    icon: TranscriptIcons.sentinel,
    word: "Observed",
    tone: "neutral",
  },
  bypassed: {
    icon: TranscriptIcons.sentinel,
    word: "Bypassed",
    tone: "neutral",
  },
  cancelled: {
    icon: TranscriptIcons.sentinel,
    word: "Cancelled",
    tone: "neutral",
  },
  superseded: {
    icon: TranscriptIcons.sentinel,
    word: "Superseded",
    tone: "neutral",
  },
  reject: { ...rejectLook, word: "Rejected" },
  terminate: { ...rejectLook, word: "Terminated" },
  modify: {
    icon: "bi bi-binoculars-fill",
    word: "Modified",
    tone: "modify",
    iconClass: checkClasses.modifyIcon,
    textClass: checkClasses.modifyText,
  },
  escalate: {
    icon: TranscriptIcons.approvals.escalate,
    word: "Escalated",
    tone: "modify",
    iconClass: checkClasses.modifyIcon,
    textClass: checkClasses.modifyText,
  },
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
    case "continue":
      return styles.continue;
  }
};
