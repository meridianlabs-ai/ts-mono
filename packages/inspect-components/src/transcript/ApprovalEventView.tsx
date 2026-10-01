import clsx from "clsx";
import { FC } from "react";

import type { ApprovalEvent } from "@tsmono/inspect-common/types";
import { ContentText, MarkdownDiv } from "@tsmono/react/components";

import { useFormattedData } from "../content/DisplayModeContext";

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
  const formatted = useFormattedData();
  const event = eventNode.event;
  const decision = event.decision;
  const explanation =
    (formatted ? event.explanation?.trim() : event.explanation) ?? "";
  const approver = event.approver;
  const alarming = decision === "reject" || decision === "terminate";
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
        explanation && explanationIsBlock ? (
          <MarkdownDiv markdown={explanation} />
        ) : undefined
      }
    >
      <span className={styles.headline}>
        <span className={clsx("text-style-secondary")}>
          (<ContentText text={approver} />)
        </span>
        {explanation && !explanationIsBlock ? (
          <span className={styles.inlineExplanation}>
            <ContentText text={explanation} />
          </span>
        ) : null}
      </span>
    </EventRow>
  );
};

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
