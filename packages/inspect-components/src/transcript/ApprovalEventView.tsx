import clsx from "clsx";
import { FC, Fragment } from "react";

import type { ApprovalEvent } from "@tsmono/inspect-common/types";
import { MarkdownDiv } from "@tsmono/react/components";
import { useCollapsedState } from "@tsmono/react/hooks";

import styles from "./ApprovalEventView.module.css";
import { EventRow } from "./event/EventRow";
import { TranscriptIcons } from "./icons";
import {
  checkClasses,
  CheckInset,
  CheckSummary,
  ReplacedCall,
  sameArguments,
} from "./ToolCheckInset";
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
        <span className={clsx("text-style-secondary")}>({approver})</span>
        {explanation && !explanationIsBlock ? (
          <span className={styles.inlineExplanation}>{explanation}</span>
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

interface ApprovalInsetProps {
  /** The call's approval events in recording order; the last one took effect. */
  chain: EventNode<ApprovalEvent>[];
}

/**
 * The approvals of a tool call as an inset in its input region: one summary
 * row for the decision that took effect, expanding to the escalation chain.
 * A modify shows the call the approver was given, struck through.
 */
export const ApprovalInset: FC<ApprovalInsetProps> = ({ chain }) => {
  const final = chain.at(-1)!;
  const [collapsed, setCollapsed] = useCollapsedState(
    `${chain[0]!.id}-approval-chain`,
    true
  );
  const event = final.event;
  const look = decisionLook(event.decision);
  const escalated = chain
    .slice(0, -1)
    .some((n) => n.event.decision === "escalate");
  return (
    <CheckInset region="input" tone={look.tone}>
      <CheckSummary
        icon={decisionIcon(event.decision)}
        iconClassName={look.icon}
        verdict={decisionLabel(event.decision)}
        verdictClassName={look.text}
        who={event.approver}
        whoSuffix={escalated ? ", after escalation" : undefined}
        reason={event.explanation?.trim() || undefined}
        reasonClassName={look.reason}
        clampReason={chain.length > 1 && collapsed}
        toggle={
          chain.length > 1
            ? {
                label: `${chain.length} checks`,
                open: !collapsed,
                onToggle: () => setCollapsed(!collapsed),
              }
            : undefined
        }
      />
      {event.decision === "modify" &&
      event.modified &&
      !sameArguments(event.call.arguments, event.modified.arguments) ? (
        <ReplacedCall call={event.call} />
      ) : null}
      {chain.length > 1 && !collapsed ? (
        <div className={styles.chain}>
          {chain.map((node, index) => {
            const step = decisionLook(node.event.decision);
            const explanation = node.event.explanation?.trim();
            return (
              <Fragment key={node.id}>
                <span className={styles.chainIndex}>{index + 1}</span>
                <span className={styles.chainApprover}>
                  {node.event.approver}
                </span>
                <span className={clsx(styles.chainDecision, step.text)}>
                  <i
                    className={decisionIcon(node.event.decision)}
                    aria-hidden="true"
                  />
                  {node.event.decision}
                </span>
                {explanation ? (
                  <MarkdownDiv
                    markdown={explanation}
                    className={styles.chainExplanation}
                  />
                ) : (
                  <span />
                )}
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </CheckInset>
  );
};

interface DecisionLook {
  tone: "neutral" | "reject" | "modify";
  icon?: string;
  text?: string;
  reason?: string;
}

const decisionLook = (decision: ApprovalEvent["decision"]): DecisionLook => {
  switch (decision) {
    case "approve":
      return {
        tone: "neutral",
        icon: checkClasses.approveIcon,
        text: checkClasses.approveText,
      };
    case "reject":
    case "terminate":
      return {
        tone: "reject",
        icon: checkClasses.rejectIcon,
        text: checkClasses.rejectText,
        reason: checkClasses.rejectReason,
      };
    case "modify":
    case "escalate":
      return {
        tone: decision === "modify" ? "modify" : "neutral",
        icon: checkClasses.modifyIcon,
        text: checkClasses.modifyText,
      };
  }
};
