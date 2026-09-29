/**
 * Pairs ApprovalEvents to their ToolEvents by call id so the tool panel can
 * render the approvals inline (every approver the call escalated through), and maps hidden approval node ids to their
 * host tool node so deep links targeting an approval still scroll somewhere.
 */

import type { ApprovalEvent } from "@tsmono/inspect-common/types";

import { eventNodeOf } from "../types";
import type { EventNode } from "../types";

export interface ToolApprovalPairing {
  /** Tool call id → the call's approval nodes in recording order, rendered inline by ToolEventView. */
  toolApprovals: Map<string, EventNode<ApprovalEvent>[]>;
  /** Approval node ids removed from the flat node list. */
  hiddenApprovalIds: Set<string>;
  /**
   * Hidden approval node id → host tool node id. Deep links (`?event=`)
   * targeting a hidden approval scroll to the tool row that displays it.
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

  const chains = new Map<string, EventNode<ApprovalEvent>[]>();
  const unpaired: EventNode<ApprovalEvent>[] = [];
  const seen = new Set<string>();
  const walkApprovals = (nodes: EventNode[]) => {
    for (const n of nodes) {
      if (n.event.event === "approval" && !seen.has(n.id)) {
        seen.add(n.id);
        const node = eventNodeOf(n, "approval");
        if (toolNodeIdsByCallId.has(n.event.call.id)) {
          const chain = chains.get(n.event.call.id) ?? [];
          chain.push(node);
          chains.set(n.event.call.id, chain);
        } else {
          unpaired.push(node);
        }
      }
      if (n.children.length) walkApprovals(n.children);
    }
  };
  walkApprovals(eventNodes);

  const toolApprovals = new Map<string, EventNode<ApprovalEvent>[]>();
  const hiddenApprovalIds = new Set<string>();
  const approvalScrollRedirects = new Map<string, string>();
  for (const [callId, chain] of chains) {
    const toolNodeId = toolNodeIdsByCallId.get(callId)!;
    // An auto-approved call adds no information, so it shows no approval.
    if (!chain.every(isAutoApprove)) toolApprovals.set(callId, chain);
    for (const node of chain) {
      hiddenApprovalIds.add(node.id);
      approvalScrollRedirects.set(node.id, toolNodeId);
    }
  }
  // Without a tool to render in, only non-approve auto decisions stay visible.
  for (const node of unpaired) {
    if (isAutoApprove(node)) hiddenApprovalIds.add(node.id);
  }

  return { toolApprovals, hiddenApprovalIds, approvalScrollRedirects };
}

const isAutoApprove = (node: EventNode<ApprovalEvent>): boolean =>
  node.event.approver === "auto" && node.event.decision === "approve";
