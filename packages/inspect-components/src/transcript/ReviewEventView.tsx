import clsx from "clsx";
import { FC } from "react";

import type { ReviewEvent } from "@tsmono/inspect-common/types";
import { MarkdownDiv } from "@tsmono/react/components";

import styles from "./ApprovalEventView.module.css";
import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import { EventNode } from "./types";

interface ReviewEventViewProps {
  eventNode: EventNode<ReviewEvent>;
  className?: string;
}

/**
 * Renders a ReviewEvent: a reviewer's decision on an executed tool call's
 * result. Shares the approval row's styling; the decision set differs.
 */
export const ReviewEventView: FC<ReviewEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  const decision = event.decision;
  const explanation = event.explanation?.trim() ?? "";
  const reviewer = event.reviewer;
  const alarming = decision === "terminate";
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
        explanation && explanationIsBlock ? (
          <MarkdownDiv markdown={explanation} />
        ) : undefined
      }
    >
      <span className={styles.headline}>
        <span className={clsx("text-style-secondary")}>({reviewer})</span>
        {explanation && !explanationIsBlock ? (
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
