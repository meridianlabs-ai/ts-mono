import { FC } from "react";

import type { ApprovalEvent } from "@tsmono/inspect-common/types";

import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import { EventNode } from "./types";

interface ApprovalEventViewProps {
  eventNode: EventNode<ApprovalEvent>;
  className?: string | string[];
}

/**
 * Renders the ApprovalEventView component.
 */
export const ApprovalEventView: FC<ApprovalEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  return (
    <EventRow
      title={decisionLabel(event.decision)}
      icon={decisionIcon(event.decision)}
      className={className}
    >
      {event.explanation || ""}
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
