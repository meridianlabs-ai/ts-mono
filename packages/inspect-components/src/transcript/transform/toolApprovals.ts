/**
 * Pairs ApprovalEvents to their ToolEvents so the tool panel can render the
 * approvals inline (every approver the call escalated through), and maps
 * hidden approval node ids to their host tool node so deep links targeting an
 * approval still scroll somewhere.
 */

import type { ApprovalEvent } from "@tsmono/inspect-common/types";

import { eventNodeOf } from "../types";
import type { EventNode } from "../types";

export interface ToolApprovalPairing {
  /** Tool node id → the call's approval nodes in recording order, rendered inline by ToolEventView. */
  toolApprovals: Map<string, EventNode<ApprovalEvent>[]>;
  /** Approval node ids removed from the flat node list. */
  hiddenApprovalIds: Set<string>;
  /**
   * Hidden approval node id → host tool node id. Deep links (`?event=`)
   * targeting a hidden approval scroll to the tool row that displays it.
   */
  approvalScrollRedirects: Map<string, string>;
}

type ApprovalNode = EventNode<ApprovalEvent>;

/**
 * Pairs each approval chain to a ToolEvent with its call id. A chain is the
 * escalations up to the decision that ends them, and is recorded before its
 * ToolEvent, so each ToolEvent takes the oldest chain still waiting for its
 * id; a call id reused by several calls pairs each call with its own chain.
 * Approvals recorded after every ToolEvent of their id go to the last one.
 */
export function pairToolApprovals(
  eventNodes: EventNode[]
): ToolApprovalPairing {
  const chains = new Map<string, ApprovalNode[]>();
  const lastTool = new Map<string, string>();
  const waiting = new Map<string, ApprovalNode[]>();
  const seen = new Set<string>();
  const walk = (nodes: EventNode[]) => {
    for (const n of nodes) {
      // Flat lists repeat descendants alongside their ancestors.
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (n.event.event === "approval") {
        const queue = waiting.get(n.event.call.id) ?? [];
        queue.push(eventNodeOf(n, "approval"));
        waiting.set(n.event.call.id, queue);
      } else if (n.event.event === "tool") {
        const queue = waiting.get(n.event.id) ?? [];
        const end = queue.findIndex((a) => a.event.decision !== "escalate");
        const chain = queue.splice(0, end === -1 ? queue.length : end + 1);
        if (chain.length) chains.set(n.id, chain);
        lastTool.set(n.event.id, n.id);
      }
      if (n.children.length) walk(n.children);
    }
  };
  walk(eventNodes);

  const unpaired: ApprovalNode[] = [];
  for (const [callId, queue] of waiting) {
    const toolNodeId = lastTool.get(callId);
    if (!toolNodeId) unpaired.push(...queue);
    else if (queue.length) {
      chains.set(toolNodeId, [...(chains.get(toolNodeId) ?? []), ...queue]);
    }
  }

  const toolApprovals = new Map<string, ApprovalNode[]>();
  const hiddenApprovalIds = new Set<string>();
  const approvalScrollRedirects = new Map<string, string>();
  for (const [toolNodeId, chain] of chains) {
    // An auto-approved call adds no information, so it shows no approval.
    if (!chain.every(isAutoApprove)) toolApprovals.set(toolNodeId, chain);
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

const isAutoApprove = (node: ApprovalNode): boolean =>
  node.event.approver === "auto" && node.event.decision === "approve";
