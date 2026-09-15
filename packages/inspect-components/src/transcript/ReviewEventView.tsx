import clsx from "clsx";
import { FC } from "react";

import type { ReviewEvent } from "@tsmono/inspect-common/types";
import { MarkdownDiv } from "@tsmono/react/components";

import { ChainOutcomes } from "./ApprovalEventView";
import styles from "./ApprovalEventView.module.css";
import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import { chainOutcomes } from "./transform/chainOutcomes";
import { EventNode } from "./types";

interface ReviewEventViewProps {
  eventNode: EventNode<ReviewEvent>;
  className?: string;
  /** Name the chain in the label (off when rendered under a chain heading). */
  showChain?: boolean;
  /** Render a summary's per-chain breakdown (off when the chains are rendered as blocks). */
  showChains?: boolean;
}

/**
 * Renders a ReviewEvent: a reviewer's decision on an executed tool call's
 * result. Shares the approval row's styling; the decision set differs.
 */
export const ReviewEventView: FC<ReviewEventViewProps> = ({
  eventNode,
  className,
  showChain = true,
  showChains = true,
}) => {
  const event = eventNode.event;
  const decision = event.decision;
  const explanation = event.explanation?.trim() ?? "";
  const reviewer = event.reviewer;
  const alarming = decision === "terminate";
  const explanationIsBlock = explanation.includes("\n");
  const chains = chainOutcomes(event);
  const source =
    event.chain && showChain
      ? `by reviewer "${reviewer}" (chain "${event.chain}")`
      : `by reviewer "${reviewer}"`;

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

const decisionLabel = (decision: string): string => {
  switch (decision) {
    case "continue":
      return "Reviewed";
    case "terminate":
      return "Terminated";
    case "escalate":
      return "Escalated";
    default:
      return decision;
  }
};

const decisionIcon = (decision: string): string => {
  switch (decision) {
    case "terminate":
      return TranscriptIcons.approvals.terminate;
    case "escalate":
      return TranscriptIcons.approvals.escalate;
    default:
      return TranscriptIcons.approvals.approve;
  }
};
