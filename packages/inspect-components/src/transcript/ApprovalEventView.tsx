import clsx from "clsx";
import { FC } from "react";

import type { ApprovalEvent, ReviewEvent } from "@tsmono/inspect-common/types";
import { MarkdownDiv } from "@tsmono/react/components";

import styles from "./ApprovalEventView.module.css";
import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import { EventNode } from "./types";

interface ApprovalEventViewProps {
  eventNode: EventNode<ApprovalEvent>;
  className?: string;
}

/**
 * Renders the ApprovalEventView component.
 */
export const ApprovalEventView: FC<ApprovalEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  const decision = event.decision;
  const explanation = event.explanation?.trim() ?? "";
  const approver = event.approver;
  const alarming = decision === "reject" || decision === "terminate";
  // The combined decision of several policy chains: show each chain's own
  // decision rather than the one-line summary that names them all.
  const chains = chainOutcomes(event);
  const source = event.chain
    ? `by approver "${approver}" (chain "${event.chain}")`
    : `by approver "${approver}"`;
  // Break the explanation out into a markdown block only when it has
  // structure (newlines → paragraphs/lists/code). Otherwise leave it
  // inline so short rationales sit on the same line as `(approver)`,
  // wrapping naturally when the row is too narrow.
  const explanationIsBlock = explanation.includes("\n");

  return (
    <EventRow
      eventNodeId={eventNode.id}
      title={
        alarming ? (
          <span className={styles.rejected}>{decisionLabel(decision)}</span>
        ) : (
          decisionLabel(decision)
        )
      }
      icon={decisionIcon(decision)}
      iconClassName={alarming ? styles.rejected : undefined}
      className={className}
      below={
        chains ? (
          <ChainOutcomes chains={chains} />
        ) : explanation && explanationIsBlock ? (
          <MarkdownDiv markdown={explanation} />
        ) : undefined
      }
    >
      <span className={styles.headline}>
        <span className={clsx("text-style-secondary")}>
          (
          {chains
            ? `combined decision of chains ${Object.keys(chains)
                .map((name) => `"${name}"`)
                .join(", ")}`
            : source}
          )
        </span>
        {!chains && explanation && !explanationIsBlock ? (
          <span className={styles.inlineExplanation}>{explanation}</span>
        ) : null}
      </span>
    </EventRow>
  );
};

interface ChainOutcome {
  decision: string;
  explanation: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The per-chain outcomes a policy summary event carries in its metadata. */
export const chainOutcomes = (
  event: ApprovalEvent | ReviewEvent
): Record<string, ChainOutcome> | undefined => {
  const source = "approver" in event ? event.approver : event.reviewer;
  if (source !== "policy" || !isRecord(event.metadata)) return undefined;
  const chains = event.metadata.chains;
  if (!isRecord(chains)) return undefined;
  const outcomes: Record<string, ChainOutcome> = {};
  for (const [name, outcome] of Object.entries(chains)) {
    if (isRecord(outcome) && "decision" in outcome) {
      outcomes[name] = {
        decision: String(outcome.decision),
        explanation:
          typeof outcome.explanation === "string" ? outcome.explanation : null,
      };
    }
  }
  return Object.keys(outcomes).length > 0 ? outcomes : undefined;
};

export const ChainOutcomes: FC<{ chains: Record<string, ChainOutcome> }> = ({
  chains,
}) => (
  <div className={styles.chains}>
    {Object.entries(chains).map(([name, outcome]) => (
      <div key={name} className={styles.chain}>
        <span className={clsx("text-style-secondary")}>{name}:</span>{" "}
        <span
          className={
            outcome.decision === "reject" || outcome.decision === "terminate"
              ? styles.rejected
              : undefined
          }
        >
          {outcome.decision}
        </span>
        {outcome.explanation ? (
          <span className={styles.inlineExplanation}>
            {outcome.explanation}
          </span>
        ) : null}
      </div>
    ))}
  </div>
);

const decisionLabel = (decision: string): string => {
  switch (decision) {
    case "approve":
      return "Approved";
    case "reject":
      return "Rejected";
    case "terminate":
      return "Terminated";
    case "escalate":
      return "Escalated";
    case "modify":
      return "Modified";
    default:
      return decision;
  }
};

const decisionIcon = (decision: string): string => {
  switch (decision) {
    case "approve":
      return TranscriptIcons.approvals.approve;
    case "reject":
      return TranscriptIcons.approvals.reject;
    case "terminate":
      return TranscriptIcons.approvals.terminate;
    case "escalate":
      return TranscriptIcons.approvals.escalate;
    case "modify":
      return TranscriptIcons.approvals.modify;
    default:
      return TranscriptIcons.approve;
  }
};
