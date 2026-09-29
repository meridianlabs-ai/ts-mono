import clsx from "clsx";
import { FC } from "react";

import type { SentinelEvent } from "@tsmono/inspect-common/types";
import { ExpandablePanel, MarkdownDiv } from "@tsmono/react/components";
import { useCollapsedState } from "@tsmono/react/hooks";

import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import styles from "./SentinelEventView.module.css";
import {
  buildSentinelStep,
  foldedSummary,
  formatSuspicion,
  instanceLabel,
  type SentinelNode,
  type SentinelRow,
  type SentinelStep,
} from "./transform/toolSentinels";
import type { EventNode } from "./types";

interface SentinelStepViewProps {
  step: SentinelStep;
  className?: string;
}

/**
 * Renders the sentinel reports for one step: a compact row per observation or
 * decision, nested by instance path. Bypassed, superseded and cancelled events
 * fold into a note on the decision that took effect.
 */
export const SentinelStepView: FC<SentinelStepViewProps> = ({
  step,
  className,
}) => (
  <div className={clsx(styles.step, "text-size-small", className)}>
    {step.rows.map((row) => (
      <SentinelRowView key={row.node.id} row={row} />
    ))}
    {step.folded[0] ? (
      <FoldedNote id={step.folded[0].id} folded={step.folded} depth={0} />
    ) : null}
  </div>
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
}) => {
  const resolved = step ?? buildSentinelStep([eventNode]);
  return (
    <EventRow
      eventNodeId={eventNode.id}
      title="Sentinel"
      icon={TranscriptIcons.sentinel}
      className={className}
      below={<SentinelStepView step={resolved} />}
    >
      <span className="text-style-secondary">
        {stageLabels[resolved.stage]}
      </span>
    </EventRow>
  );
};

const SentinelRowView: FC<{ row: SentinelRow }> = ({ row }) => {
  const event = row.node.event;
  const explanation = event.explanation?.trim() ?? "";
  const indent = { paddingLeft: `${row.depth * 1.25}em` };
  return (
    <div className={styles.entry}>
      <div className={styles.row} style={indent}>
        <i
          className={clsx(
            TranscriptIcons.sentinel,
            styles.icon,
            event.decision && decisionClass(event.decision)
          )}
        />
        <span
          className={styles.label}
          title={event.function ? `${event.name} · ${event.function}` : ""}
        >
          {instanceLabel(event)}
        </span>
        {event.path ? (
          <span className={clsx(styles.factory, "text-style-secondary")}>
            {event.name}
          </span>
        ) : null}
        <KindBadge kind={row.superseded ? "superseded" : event.kind} />
        <ReportValue event={event} />
        {event.audit ? (
          <span className={clsx(styles.badge, styles.audit)}>audit</span>
        ) : null}
      </div>
      {explanation ? (
        <div className={styles.explanation} style={indent}>
          <ExpandablePanel
            id={`${row.node.id}-sentinel-explanation`}
            collapse={true}
            lines={3}
          >
            <MarkdownDiv markdown={explanation} />
          </ExpandablePanel>
        </div>
      ) : null}
      {row.folded.length > 0 ? (
        <FoldedNote id={row.node.id} folded={row.folded} depth={row.depth} />
      ) : null}
    </div>
  );
};

const ReportValue: FC<{ event: SentinelEvent }> = ({ event }) => {
  if (event.suspicion !== undefined && event.suspicion !== null) {
    return (
      <span className={styles.value}>{formatSuspicion(event.suspicion)}</span>
    );
  }
  if (!event.decision) return null;
  return (
    <span className={styles.value}>
      <span className={decisionClass(event.decision)}>{event.decision}</span>
      {event.outcome && event.outcome !== event.decision ? (
        <span className="text-style-secondary">
          {" "}
          →{" "}
          <span className={decisionClass(event.outcome)}>{event.outcome}</span>
        </span>
      ) : null}
    </span>
  );
};

const KindBadge: FC<{ kind: SentinelEvent["kind"] }> = ({ kind }) => (
  <span className={clsx(styles.badge, kindClasses[kind])}>{kind}</span>
);

interface FoldedNoteProps {
  id: string;
  folded: SentinelNode[];
  depth: number;
}

const FoldedNote: FC<FoldedNoteProps> = ({ id, folded, depth }) => {
  const [collapsed, setCollapsed] = useCollapsedState(
    `${id}-sentinel-folded`,
    true
  );
  return (
    <div className={styles.folded} style={{ paddingLeft: `${depth * 1.25}em` }}>
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
        {foldedSummary(folded)}
      </button>
      {collapsed ? null : (
        <ul className={styles.foldedList}>
          {folded.map((node) => (
            <li key={node.id} className={styles.foldedItem}>
              <KindBadge kind={node.event.kind} />
              <span className={styles.label}>{instanceLabel(node.event)}</span>
              {node.event.decision ? (
                <span className={styles.value}>{node.event.decision}</span>
              ) : null}
              {node.event.explanation ? (
                <span className={styles.foldedExplanation}>
                  {node.event.explanation}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const stageLabels: Record<SentinelEvent["stage"], string> = {
  model_input: "model input",
  model_output: "model output",
  tool_call: "tool call",
  tool_result: "tool result",
};

const kindClasses: Record<SentinelEvent["kind"], string | undefined> = {
  observation: styles.observation,
  decision: styles.decision,
  superseded: styles.muted,
  bypassed: styles.muted,
  cancelled: styles.muted,
};

const decisionClass = (
  decision: NonNullable<SentinelEvent["decision"]>
): string | undefined => {
  switch (decision) {
    case "reject":
    case "terminate":
      return styles.alarming;
    case "escalate":
    case "modify":
      return styles.cautious;
    case "continue":
      return undefined;
  }
};
