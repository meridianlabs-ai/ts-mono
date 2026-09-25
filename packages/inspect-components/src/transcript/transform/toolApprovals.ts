/**
 * Pairs ApprovalEvents and ReviewEvents to their ToolEvents by call id so the
 * tool panel can render them inline, and maps the hidden nodes' ids to their
 * host tool node so deep links targeting one still scroll somewhere.
 *
 * A call can carry several approvals (an escalation chain, or several policy
 * chains each deciding on their own, plus the combined summary) and several
 * reviews, so each call maps to the list of them in transcript order.
 */

import type { ApprovalEvent, ReviewEvent } from "@tsmono/inspect-common/types";

import { eventNodeOf } from "../types";
import type { EventNode } from "../types";

export interface ToolApprovalPairing {
  /** Tool call id → approval nodes rendered inline by ToolEventView, in order. */
  toolApprovals: Map<string, EventNode<ApprovalEvent>[]>;
  /** Tool call id → review nodes rendered inline by ToolEventView, in order. */
  toolReviews: Map<string, EventNode<ReviewEvent>[]>;
  /** Approval and review node ids removed from the flat node list. */
  hiddenApprovalIds: Set<string>;
  /**
   * Hidden node id → host tool node id. Deep links (`?event=`) targeting a
   * hidden approval or review scroll to the tool row that displays it.
   */
  approvalScrollRedirects: Map<string, string>;
}

export function pairToolApprovals(
  eventNodes: EventNode[]
): ToolApprovalPairing {
  const toolNodeIdsByCallId = new Map<string, string>();
  const walkTools = (nodes: EventNode[]) => {
    for (const n of nodes) {
      if (n.event.event === "tool" && !toolNodeIdsByCallId.has(n.event.id)) {
        toolNodeIdsByCallId.set(n.event.id, n.id);
      }
      if (n.children.length) walkTools(n.children);
    }
  };
  walkTools(eventNodes);

  const toolApprovals = new Map<string, EventNode<ApprovalEvent>[]>();
  const toolReviews = new Map<string, EventNode<ReviewEvent>[]>();
  const hiddenApprovalIds = new Set<string>();
  const approvalScrollRedirects = new Map<string, string>();
  const walk = (nodes: EventNode[]) => {
    for (const n of nodes) {
      if (n.event.event === "approval") {
        const toolNodeId = toolNodeIdsByCallId.get(n.event.call.id);
        // Auto-approved calls add no information — hide them entirely
        // (don't pair, don't surface as flat rows). Non-approve auto
        // decisions (reject/terminate/…) stay visible.
        const isAutoApprove =
          n.event.approver === "auto" && n.event.decision === "approve";
        if (isAutoApprove) {
          hiddenApprovalIds.add(n.id);
          if (toolNodeId) approvalScrollRedirects.set(n.id, toolNodeId);
        } else if (toolNodeId) {
          const paired = toolApprovals.get(n.event.call.id) ?? [];
          paired.push(eventNodeOf(n, "approval"));
          toolApprovals.set(n.event.call.id, paired);
          hiddenApprovalIds.add(n.id);
          approvalScrollRedirects.set(n.id, toolNodeId);
        }
      } else if (n.event.event === "review") {
        const toolNodeId = toolNodeIdsByCallId.get(n.event.call.id);
        if (toolNodeId) {
          const paired = toolReviews.get(n.event.call.id) ?? [];
          paired.push(eventNodeOf(n, "review"));
          toolReviews.set(n.event.call.id, paired);
          hiddenApprovalIds.add(n.id);
          approvalScrollRedirects.set(n.id, toolNodeId);
        }
      }
      if (n.children.length) walk(n.children);
    }
  };
  walk(eventNodes);

  return {
    toolApprovals,
    toolReviews,
    hiddenApprovalIds,
    approvalScrollRedirects,
  };
}
