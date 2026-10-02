import clsx from "clsx";
import { FC } from "react";

import type { ApprovalEvent } from "@tsmono/inspect-common/types";
import { MarkdownDiv } from "@tsmono/react/components";

import styles from "./ApprovalEventView.module.css";
import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import { chainOutcomes } from "./transform/chainOutcomes";
import type { ChainOutcome } from "./transform/chainOutcomes";
import { EventNode } from "./types";

interface ApprovalEventViewProps {
  eventNode: EventNode<ApprovalEvent>;
  className?: string;
  /** Name the chain in the label (off when rendered under a chain heading). */
  showChain?: boolean;
  /** Render a summary's per-chain breakdown (off when the chains are rendered as blocks). */
  showChains?: boolean;
}

/**
 * Renders the ApprovalEventView component.
 */
export const ApprovalEventView: FC<ApprovalEventViewProps> = ({
  eventNode,
  className,
  showChain = true,
  showChains = true,
}) => {
  const event = eventNode.event;
  const decision = event.decision;
  const explanation = event.explanation?.trim() ?? "";
  const approver = event.approver;
  const alarming = decision === "reject" || decision === "terminate";
  // The combined decision of several policy chains: show each chain's own
  // decision rather than the one-line summary that names them all.
  const chains = chainOutcomes(event);
  const source =
    event.chain && showChain
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
          showChains ? (
            <ChainOutcomes chains={chains} />
          ) : undefined
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
