/**
 * Pairs ApprovalEvents to their ToolEvents so the tool panel can render the
 * approvals inline (every approver the call escalated through), and maps
 * hidden approval node ids to their host tool node so deep links targeting an
 * approval still scroll somewhere.
 */

import type { ApprovalEvent, ToolEvent } from "@tsmono/inspect-common/types";

import { eventNodeOf } from "../types";
import type { EventNode } from "../types";

import {
  approvalRejects,
  approvalStopped,
  bridgeOutputs,
  buildSentinelStep,
  executionIdOf,
  isBridgeTool,
  isConversationNode,
  isSentinelSpan,
  kBridgeCheckSpan,
  runIdOf,
  stopsCall,
  toolFailed,
  treeRecordsExecutionIds,
} from "./toolSentinels";
import type { SentinelNode } from "./toolSentinels";
import { SPAN_BEGIN } from "./utils";

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
 * Pairs each approval chain to its ToolEvent. A sample whose log records
 * `execution_id` (`recordsExecutionIds`) pairs by execution
 * (`pairToolApprovalsByExecution`); any other exactly as before the field
 * (`pairToolApprovalsLegacy`). Callers that render part of a sample pass the
 * sample's answer, so every view of it pairs the same way.
 */
export function pairToolApprovals(
  eventNodes: EventNode[],
  recordsExecutions: boolean = treeRecordsExecutionIds(eventNodes)
): ToolApprovalPairing {
  return recordsExecutions
    ? pairToolApprovalsByExecution(eventNodes)
    : pairToolApprovalsLegacy(eventNodes);
}

/**
 * Splits approvals waiting for one call id into chains: the escalations up
 * to the decision that ends them. A trailing chain may have no such decision.
 */
const splitChains = (queue: ApprovalNode[]): ApprovalNode[][] => {
  const result: ApprovalNode[][] = [];
  let chain: ApprovalNode[] = [];
  for (const node of queue) {
    chain.push(node);
    if (node.event.decision !== "escalate") {
      result.push(chain);
      chain = [];
    }
  }
  if (chain.length) result.push(chain);
  return result;
};

/** Whether the decision that ended a chain kept its call from running. */
const chainStopped = (chain: ApprovalNode[]): boolean => {
  const last = chain.at(-1)?.event;
  return !!last && last.decision !== "escalate" && approvalStopped(last);
};

/** The sentinel events of a sentinel span's own step, outside spans nested in it. */
const stepNodes = (span: EventNode): SentinelNode[] => {
  const nodes: SentinelNode[] = [];
  const collect = (children: EventNode[]) => {
    for (const child of children) {
      if (child.event.event === "sentinel") {
        nodes.push(eventNodeOf(child, "sentinel"));
      } else if (!isSentinelSpan(child)) {
        collect(child.children);
      }
    }
  };
  collect(span.children);
  return nodes;
};

/**
 * Pairs each approval chain to the ToolEvent its execution id names
 * (`executionIdOf`, `runIdOf`), in the same sentinel span and conversation
 * (`isConversationNode`): an approver's or monitor's own calls run inside the
 * span that called it, and a delegated or sibling agent's calls in its own
 * conversation, under ids the agent's calls may share. A chain that records
 * its `execution_id` pairs with the one such tool, or none. A bridged call's
 * handout can run once per bridged tool it denotes, and is approved once per
 * tool, so among several runs of one handout an approval pairs with the run
 * of the tool it reviewed.
 *
 * Otherwise its id is the model's, which calls on different turns can share.
 * A chain is the escalations up to the decision that ends them, and is
 * recorded before its ToolEvent:
 * - A bridge hands over only a call nothing stopped, and records no
 *   `execution_id` for an attempt it never handed over. A chain whose
 *   decision stopped its call, or still waiting when the bridge's check of
 *   its id stopped the call, judged no host run: a rejected attempt's
 *   approvals precede the accepted retry's run under the same id. A host
 *   run under the model's id takes the other chains waiting for it (a call
 *   reviewed as several bridged tools is approved once per tool), and none
 *   recorded after it, since a bridge hands a call over once reviewed. No
 *   approval of an output the bridge discarded pairs with a run (see
 *   `BridgeOutputs`): it judged a call that never ran, though it approved.
 * - Each native attempt records its ToolEvent, a stopped one as failed, so a
 *   native ToolEvent takes the oldest chain still waiting for its id, and a
 *   stopped chain only when the ToolEvent failed. Approvals recorded after
 *   every ToolEvent of their id go to the last one when it is native.
 */
function pairToolApprovalsByExecution(
  eventNodes: EventNode[]
): ToolApprovalPairing {
  const chains = new Map<string, ApprovalNode[]>();
  /** By scope and `runIdOf`, the tools an approval's `execution_id` may name. */
  const toolsOf = new Map<string, EventNode<ToolEvent>[]>();
  const lastTool = new Map<string, EventNode<ToolEvent>>();
  const waiting = new Map<string, ApprovalNode[]>();
  const named: { node: ApprovalNode; key: string }[] = [];
  const unpaired: ApprovalNode[] = [];
  const order = new Map<string, number>();
  const outputs = bridgeOutputs();
  /** The output each approval with no `execution_id` judged a call of. */
  const outputOf = new Map<string, string>();
  const take = (key: string): ApprovalNode[][] => {
    const queue = waiting.get(key) ?? [];
    waiting.delete(key);
    return splitChains(queue);
  };
  const walk = (nodes: EventNode[], scope: string) => {
    for (const n of nodes) {
      // Flat lists repeat descendants alongside their ancestors.
      if (order.has(n.id)) continue;
      const at = order.size;
      order.set(n.id, at);
      if (n.event.event === "model") {
        outputs.propose(
          scope,
          n.id,
          !!n.event.requested_model,
          n.event.output.choices.flatMap((choice) =>
            (choice.message.tool_calls ?? []).map((call) => call.id)
          ),
          at
        );
      } else if (n.event.event === "approval") {
        const node = eventNodeOf(n, "approval");
        const key = `${scope}\u0000${executionIdOf(n.event)}`;
        if (n.event.execution_id != null) {
          named.push({ node, key });
        } else {
          const output = outputs.outputOf(scope, n.event.call.id, at);
          if (output !== undefined) outputOf.set(n.id, output);
          if (approvalRejects(n.event)) outputs.discard(output);
          const queue = waiting.get(key) ?? [];
          queue.push(node);
          waiting.set(key, queue);
        }
      } else if (n.event.event === "tool") {
        const tool = eventNodeOf(n, "tool");
        const key = `${scope}\u0000${n.event.id}`;
        if (isBridgeTool(n.event)) {
          const own: ApprovalNode[] = [];
          for (const chain of take(key)) {
            (chainStopped(chain) ? unpaired : own).push(...chain);
          }
          if (own.length) chains.set(n.id, own);
        } else {
          const queue = splitChains(waiting.get(key) ?? []);
          let chain = queue.shift();
          while (chain && chainStopped(chain) && !toolFailed(n.event)) {
            unpaired.push(...chain);
            chain = queue.shift();
          }
          if (chain) chains.set(n.id, chain);
          waiting.set(key, queue.flat());
        }
        const runKey = `${scope}\u0000${runIdOf(n.event)}`;
        const tools = toolsOf.get(runKey);
        if (tools) tools.push(tool);
        else toolsOf.set(runKey, [tool]);
        lastTool.set(key, tool);
      } else if (
        isSentinelSpan(n) &&
        n.event.event === SPAN_BEGIN &&
        n.event.name === kBridgeCheckSpan
      ) {
        const step = buildSentinelStep(stepNodes(n));
        if (
          step.stage === "tool_call" &&
          step.executionId === undefined &&
          stopsCall(step)
        ) {
          unpaired.push(...take(`${scope}\u0000${step.stepId}`).flat());
          outputs.discard(outputs.outputOf(scope, step.stepId, at));
        }
      }
      if (n.children.length) {
        walk(
          n.children,
          isSentinelSpan(n) || isConversationNode(n)
            ? `${scope}\u0000${n.id}`
            : scope
        );
      }
    }
  };
  walk(eventNodes, "");

  const append = (toolNodeId: string, nodes: ApprovalNode[]) => {
    chains.set(
      toolNodeId,
      [...(chains.get(toolNodeId) ?? []), ...nodes].sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
      )
    );
  };
  for (const [key, queue] of waiting) {
    const tool = lastTool.get(key);
    for (const chain of splitChains(queue)) {
      if (
        tool &&
        !isBridgeTool(tool.event) &&
        (!chainStopped(chain) || toolFailed(tool.event))
      ) {
        append(tool.id, chain);
      } else {
        unpaired.push(...chain);
      }
    }
  }
  for (const { node, key } of named) {
    const runs = toolsOf.get(key) ?? [];
    const [only, other] =
      runs.length > 1 && runs[0]?.event.execution_id != null
        ? runs.filter((run) => run.event.function === node.event.call.function)
        : runs;
    if (only && !other) append(only.id, [node]);
    else unpaired.push(node);
  }
  // Whether an output was discarded is known only once a later sibling's
  // decision is recorded, so its approvals leave their runs here.
  const discarded = (node: ApprovalNode) =>
    outputs.discarded(outputOf.get(node.id));
  for (const [toolNodeId, chain] of chains) {
    if (!chain.some(discarded)) continue;
    const kept = chain.filter((node) => !discarded(node));
    unpaired.push(...chain.filter(discarded));
    if (kept.length) chains.set(toolNodeId, kept);
    else chains.delete(toolNodeId);
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

// Logs that record no `execution_id` pair with origin/main's rules, kept
// verbatim below (renamed) so their transcripts render as they always have.

/**
 * Pairs each approval chain to a ToolEvent with its call id. A chain is the
 * escalations up to the decision that ends them, and is recorded before its
 * ToolEvent, so each ToolEvent takes the oldest chain still waiting for its
 * id; a call id reused by several calls pairs each call with its own chain.
 * Approvals recorded after every ToolEvent of their id go to the last one.
 */
function pairToolApprovalsLegacy(eventNodes: EventNode[]): ToolApprovalPairing {
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
