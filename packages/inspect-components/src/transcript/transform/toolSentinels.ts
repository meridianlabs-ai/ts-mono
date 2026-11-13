import type {
  ApprovalEvent,
  Event,
  ModelEvent,
  Reference,
  SentinelEvent,
  ToolCall,
  ToolEvent,
} from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

import { EventNode, eventNodeOf } from "../types";

import {
  SPAN_BEGIN,
  SUBTASK,
  TYPE_AGENT,
  TYPE_SENTINEL,
  TYPE_SOLVER,
  TYPE_SUBTASK,
} from "./utils";

export type SentinelNode = EventNode<SentinelEvent>;

/** The span a sentinel's dispatch runs in; it holds the step's events and the model calls its monitors made. */
export const isSentinelSpan = (node: EventNode): boolean =>
  node.event.event === SPAN_BEGIN && node.event.type === TYPE_SENTINEL;

const kConversationSpanTypes: ReadonlySet<string> = new Set([
  TYPE_AGENT,
  TYPE_SUBTASK,
  TYPE_SOLVER,
]);

/**
 * A node that opens a conversation, as the Activity view keys its rows: an
 * agent, subtask or solver span, or the subtask event the tree puts in place
 * of a subtask's span. Agents reuse call ids, so a call pairs only with the
 * proposals, approvals and checks of its own conversation: a delegated or
 * sibling agent's `call_1` is not its parent's.
 */
export const isConversationNode = (node: EventNode): boolean =>
  node.event.event === SUBTASK ||
  (node.event.event === SPAN_BEGIN &&
    node.event.type != null &&
    kConversationSpanTypes.has(node.event.type));

/** The name of the sentinel spans an agent bridge records its tool checks in (inspect_ai#5765); native checks record in spans named `sentinel`. */
export const kBridgeCheckSpan = "sentinel_bridge";

/** Whether a sandbox agent bridge ran the call on the host, which records it with `metadata.bridge`. */
export const isBridgeTool = (event: ToolEvent): boolean =>
  event.metadata != null && "bridge" in event.metadata;

/**
 * The model's id for the call a ToolEvent ran, which its proposal carries: a
 * bridge records it as `metadata.bridge.proposal_id`, which differs from the
 * event's id when the bridge handed the call to its scaffold under a new id
 * (inspect_ai#6369). Otherwise the event's id.
 */
export const proposalIdOf = (event: ToolEvent): string =>
  recordedProposalId(event) ?? event.id;

/** The `metadata.bridge.proposal_id` a bridge recorded for its run, if any. */
export const recordedProposalId = (event: ToolEvent): string | undefined => {
  const bridge = event.metadata?.bridge;
  return isRecord(bridge) && typeof bridge.proposal_id === "string"
    ? bridge.proposal_id
    : undefined;
};

/**
 * The id of the execution a tool-stage sentinel event or an approval judged,
 * which `runIdOf` names its runs by: its `execution_id`, else the model's id.
 */
export const executionIdOf = (event: SentinelEvent | ApprovalEvent): string =>
  event.execution_id ??
  (event.event === "sentinel" ? event.step_id : event.call.id);

/**
 * The id a check's or approval's `execution_id` names a run by. A ToolEvent
 * that records `execution_id` (inspect_ai#6370) is named by it: a native
 * run's own, or the handout of a bridged call, which every run of that
 * handout shares. Before that field, `execution_id` was the ToolEvent's own
 * id, which a bridge recorded when it handed a call over under a new one. A
 * minted id never equals a call id, so the two meanings never meet: a run
 * that records none (an older log, or a host run that matched two handouts'
 * grants) is named only by its id.
 */
export const runIdOf = (tool: ToolEvent): string =>
  tool.execution_id ?? tool.id;

/** Whether a ToolEvent records a call that failed or never ran. */
export const toolFailed = (event: ToolEvent): boolean =>
  event.error != null || event.failed === true;

/** An approval decision that kept its call from running. */
export const approvalStopped = (approval: ApprovalEvent): boolean =>
  approval.decision !== "approve" && approval.decision !== "modify";

/** A `tool_call` step that kept its call from running. */
export const stopsCall = (step: SentinelStep): boolean =>
  !!step.effective && step.verdict !== "proceed" && step.verdict !== "modify";

/**
 * An approval decision that rejected its call. A bridge then discards the
 * whole output that proposed it (`apply_bridge_tool_approval` in inspect_ai),
 * and approval stops at that decision, so no other decision follows it.
 */
export const approvalRejects = (approval: ApprovalEvent): boolean =>
  approval.decision === "reject" || approval.decision === "terminate";

/**
 * Which model output each approval or `tool_call` check with no
 * `execution_id` judged a call of, and which outputs a bridge discarded.
 *
 * A bridge reviews an output's calls right after the generation that made it,
 * so their records follow its ModelEvent, in its conversation, and belong to
 * the latest output there that proposed their id. When any call is rejected
 * (by an approval, or by a bridge check that stopped it) the bridge discards
 * the whole output and hands none of its calls over, so its other calls'
 * approvals and checks judged calls that never ran, though their own
 * decisions let them through. Only a bridge generation (`requested_model`)
 * is discarded this way: a native rejection stops only its own call.
 */
export interface BridgeOutputs {
  /** Records an output's calls, at `order` in recording order. */
  propose: (
    conversation: string,
    output: string,
    bridged: boolean,
    ids: Iterable<string>,
    order: number
  ) => void;
  /** The bridge output that proposed `id` latest before `order`, if the latest output to propose it is a bridge's. */
  outputOf: (
    conversation: string,
    id: string,
    order: number
  ) => string | undefined;
  discard: (output: string | undefined) => void;
  discarded: (output: string | undefined) => boolean;
}

export const bridgeOutputs = (): BridgeOutputs => {
  // By conversation and call id, the outputs that proposed it, oldest first;
  // `output` is unset for an output that was not a bridge's.
  const byId = new Map<string, { order: number; output?: string }[]>();
  const discarded = new Set<string>();
  const key = (conversation: string, id: string) =>
    `${conversation}\u0000${id}`;
  return {
    propose: (conversation, output, bridged, ids, order) => {
      for (const id of new Set(ids)) {
        const proposals = byId.get(key(conversation, id)) ?? [];
        proposals.push({ order, output: bridged ? output : undefined });
        byId.set(key(conversation, id), proposals);
      }
    },
    outputOf: (conversation, id, order) => {
      const proposals = byId.get(key(conversation, id)) ?? [];
      // Proposals are recorded in order: find the last one before `order`.
      let lo = 0;
      let hi = proposals.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (proposals[mid]!.order < order) lo = mid + 1;
        else hi = mid;
      }
      return proposals[lo - 1]?.output;
    },
    discard: (output) => {
      if (output !== undefined) discarded.add(output);
    },
    discarded: (output) => output !== undefined && discarded.has(output),
  };
};

const recordsExecutionId = (event: Event): boolean =>
  (event.event === "sentinel" || event.event === "approval") &&
  event.execution_id != null;

/**
 * Whether a sample's log records `execution_id` (inspect_ai#6370) on any
 * sentinel step or approval. Only such logs pair by execution; older ones
 * keep the pairing they always had, since their records cannot say which run
 * of a reused id a check or approval judged. Inspect leaves null fields out
 * of a log, so a null counts as absent, as it does in a store that fills
 * every missing field with null.
 */
export const recordsExecutionIds = (events: readonly Event[]): boolean =>
  events.some(recordsExecutionId);

/** `recordsExecutionIds` over an event tree or flat node list. */
export const treeRecordsExecutionIds = (
  nodes: readonly EventNode[]
): boolean => {
  const seen = new Set<string>();
  const stack = [...nodes];
  for (let n = stack.pop(); n; n = stack.pop()) {
    // Flat lists repeat descendants alongside their ancestors.
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (recordsExecutionId(n.event)) return true;
    for (const child of n.children) stack.push(child);
  }
  return false;
};

const sameJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => sameJson(value, b[i]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && sameJson(a[key], b[key]))
  );
};

const sameCall = (a: ToolCall, b: ToolCall): boolean =>
  a.function === b.function && sameJson(a.arguments, b.arguments);

/**
 * What a conversation's outputs proposed under one call id, as much as a run
 * needs to name its proposal without inference: the first call, whether any
 * other call differed from it, and the first two outputs that proposed it.
 */
export interface ProposedCalls<Output> {
  call: ToolCall;
  /** Position of the call's first proposal in recording order. */
  order: number;
  /** An output proposed a different call under the id. */
  conflicting: boolean;
  /** The first two distinct outputs that proposed the call, oldest first. */
  outputs: { output: Output; order: number }[];
}

/** By key (conversation and call id), the calls proposed under it. */
export type ProposalIndex<Output> = Map<string, ProposedCalls<Output>>;

/** Records a proposal, comparing it with the key's first call only, so building an index is linear. */
export const addProposal = <Output>(
  index: ProposalIndex<Output>,
  key: string,
  call: ToolCall,
  output: Output,
  order: number
): void => {
  const proposed = index.get(key);
  if (!proposed) {
    index.set(key, {
      call,
      order,
      conflicting: false,
      outputs: [{ output, order }],
    });
  } else if (proposed.conflicting) {
    return;
  } else if (!sameCall(proposed.call, call)) {
    proposed.conflicting = true;
  } else if (
    proposed.outputs.length < 2 &&
    proposed.outputs[0]?.output !== output
  ) {
    proposed.outputs.push({ output, order });
  }
};

/** The call a run ran as proposed, and the output that proposed it when only one could have. */
export interface FoundProposal<Output> {
  call: ToolCall;
  output?: Output;
}

/** A run, or a call that never ran, looking up its proposal. */
export interface ProposalRun {
  /** Its position in recording order: its ToolEvent's, or its first record's. */
  order: number;
  tool?: ToolEvent;
  /** Approvals paired with the run. Only those whose `execution_id` names the run (`runIdOf`) name its proposal. */
  approvals: readonly ApprovalEvent[];
}

/** The call every one of `calls` names, or none when they differ. */
export const agreedCall = (
  calls: readonly ToolCall[]
): ToolCall | undefined => {
  const [first, ...rest] = calls;
  return first && rest.every((call) => sameCall(call, first))
    ? first
    : undefined;
};

/**
 * The call a bridge's approval reviewed for this run, joined by its
 * `execution_id`. Approval runs before any check, and every approver of a
 * call sees the call as proposed (renamed to the bridged tool it runs), so
 * it records the proposal even when a check or approver then replaced it.
 * A call several bridged tools share is reviewed once per tool, so only the
 * approvals of the tool the run executed name it: another tool's approval
 * reviewed a call the run is not.
 */
const approvedProposal = ({
  tool,
  approvals,
}: ProposalRun): ToolCall | undefined => {
  if (!tool) return undefined;
  return agreedCall(
    approvals
      .filter(
        (approval) =>
          approval.execution_id === runIdOf(tool) &&
          approval.call.function === tool.function
      )
      .map((approval) => approval.call)
  );
};

/**
 * The call a run ran as proposed, from what its conversation's outputs
 * proposed under its `proposalIdOf` (`proposed`), only when nothing could be
 * confused: the one call proposed under the id (with the output that
 * proposed it, when one output did before the run), else the call the run's
 * own approval recorded (`approvedProposal`). Otherwise unknown: outputs can
 * be outstanding together and a scaffold may rewrite a call's arguments, so
 * neither order nor argument equality identifies a proposal.
 */
export const findProposal = <Output>(
  proposed: ProposedCalls<Output> | undefined,
  run: ProposalRun
): FoundProposal<Output> | undefined => {
  if (proposed && !proposed.conflicting && proposed.order < run.order) {
    const [first, second] = proposed.outputs;
    return {
      call: proposed.call,
      output: second && second.order < run.order ? undefined : first?.output,
    };
  }
  const approved = approvedProposal(run);
  return approved ? { call: approved } : undefined;
};

export interface SentinelRow {
  node: SentinelNode;
  /** Depth in the check tree: the number of recorded ancestors above the row. */
  depth: number;
  /** Box-drawing prefix that draws the tree guides before the row's path. */
  guides: string;
  /** Whether this check made the step's decision. */
  tookEffect: boolean;
}

type InactiveStatus = Exclude<SentinelEvent["status"], "reported">;

export type SentinelVerdict =
  "observe" | InactiveStatus | NonNullable<SentinelEvent["action"]>;

/** The sentinel events recorded for one step, as a tree of checks. */
export interface SentinelStep {
  /** The id of the step's first event, which keys the step's view state. */
  id: string;
  stage: SentinelEvent["stage"];
  stepId: string;
  /** The `execution_id` the step's events record, which names the run it judged (`runIdOf`). */
  executionId?: string;
  /** One row per check in tree order; a superseded event stands in for the decision it names. */
  rows: SentinelRow[];
  verdict: SentinelVerdict;
  /** The decision the runner returned: the root's, or the one a `decide_final()` made. */
  outcome?: SentinelNode;
  /** Whether the outcome is the runner's, which nothing above it handles; unset for an event shown alone below the root. */
  returned: boolean;
  /** The check the summary names: the decision that took effect, or the top decision of a quiet step. */
  decider?: SentinelNode;
  /** The check that made the step's decision; unset when every check proceeded. */
  effective?: SentinelNode;
  /** The explanation the summary shows: the deciding check's (or the nearest above it), or the lone check's. */
  reason?: string;
  /** The references of the check the reason comes from, which link its cites. */
  reasonReferences: Reference[];
  /** The error of a step whose only check failed. */
  error?: string;
  /** Scores the summary shows for a step that did not act: each monitor's top score. */
  scores: string[];
  /** Whether any event of the step asked for an audit. */
  audit: boolean;
  /** How many monitor functions raised instead of reporting. */
  failed: number;
  /** Model calls made inside the step's sentinel span, in recording order. */
  modelCalls: EventNode<ModelEvent>[];
}

export interface ToolSentinels {
  before?: SentinelStep;
  after?: SentinelStep;
  /** The call as proposed, when nothing could be confused (`findProposal`); unset otherwise. */
  proposed?: ToolCall;
}

export interface ToolSentinelPairing {
  /** Tool node id → the steps rendered inside that tool's panel. */
  toolSentinels: Map<string, ToolSentinels>;
  /** Host node id → a step with no tool to render in; the host is the step's first event. */
  standaloneSentinels: Map<string, SentinelStep>;
  /** Sentinel node ids with no row of their own. */
  hiddenSentinelIds: Set<string>;
  /** Hidden sentinel node id → the node that renders it. */
  sentinelScrollRedirects: Map<string, string>;
}

const reported = (node: SentinelNode, kind: SentinelEvent["kind"]): boolean =>
  node.event.status === "reported" && node.event.kind === kind;

const pathSegments = (path: string): string[] =>
  path === "" ? [] : path.split("/");

interface TreeNode {
  node: SentinelNode;
  parent?: TreeNode;
  children: TreeNode[];
  depth: number;
}

interface PathLayer {
  checks: SentinelNode[];
  /** In the order each child path was first recorded. */
  children: Map<string, PathLayer>;
}

/**
 * Lays a step's checks out so a nested configuration reads top to bottom:
 * each layer above its children, siblings in the order they were first
 * recorded, and each check under the nearest recorded check above it by path.
 */
const buildTree = (checks: SentinelNode[]): TreeNode[] => {
  const newLayer = (): PathLayer => ({ checks: [], children: new Map() });
  const root = newLayer();
  for (const node of checks) {
    let layer = root;
    for (const segment of pathSegments(node.event.path)) {
      let child = layer.children.get(segment);
      if (!child) layer.children.set(segment, (child = newLayer()));
      layer = child;
    }
    layer.checks.push(node);
  }
  const tree: TreeNode[] = [];
  const visit = (layer: PathLayer, parent: TreeNode | undefined) => {
    let above = parent;
    for (const node of layer.checks) {
      const entry: TreeNode = {
        node,
        parent,
        children: [],
        depth: parent ? parent.depth + 1 : 0,
      };
      parent?.children.push(entry);
      tree.push(entry);
      above = entry;
    }
    for (const child of layer.children.values()) visit(child, above);
  };
  visit(root, undefined);
  return tree;
};

const guidesFor = (entry: TreeNode): string => {
  const isLast = (e: TreeNode) => !e.parent || e.parent.children.at(-1) === e;
  if (!entry.parent) return "";
  let prefix = isLast(entry) ? "\u2514\u2500 " : "\u251c\u2500 ";
  for (let up = entry.parent; up.parent; up = up.parent) {
    prefix = (isLast(up) ? "   " : "\u2502  ") + prefix;
  }
  return prefix;
};

const explanationOf = (node: SentinelNode | undefined): string | undefined =>
  node?.event.explanation?.trim() || undefined;

interface Credit {
  node: SentinelNode;
  /** The credited check's explanation, or the nearest one above it on the chain. */
  reason?: string;
  /** The check the reason comes from. */
  reasonSource?: SentinelNode;
}

/**
 * The check that made the step's decision: from the outcome, descend to the
 * child that made the same decision, to the lowest such descendant.
 * Explanations and replacements may differ, since combinators reword what
 * they pass up.
 */
const creditDecision = (tree: TreeNode[], outcome: SentinelNode): Credit => {
  let current = tree.find((e) => e.node === outcome)!;
  let reason = explanationOf(outcome);
  let reasonSource = reason ? outcome : undefined;
  for (;;) {
    const matching = current.children.filter(
      (c) =>
        reported(c.node, "decision") &&
        c.node.event.action === outcome.event.action
    );
    const next =
      matching.length === 1 ? matching[0] : passedUp(matching, reason);
    if (!next) return { node: current.node, reason, reasonSource };
    current = next;
    const own = explanationOf(next.node);
    if (own) {
      reason = own;
      reasonSource = next.node;
    }
  }
};

/**
 * Of several children that made the same decision, the one whose explanation
 * the explanation above begins with. Children record in completion order,
 * while combinators break ties by configuration order (`concurrent`) or take
 * the last (`sequential`), so recording order cannot tell; an explanation
 * passed up names its source. Unset when none or several match.
 */
const passedUp = (
  children: TreeNode[],
  reason: string | undefined
): TreeNode | undefined => {
  if (!reason) return undefined;
  const sources = children
    .map((child) => ({ child, text: explanationOf(child.node) }))
    .filter(({ text }) => text !== undefined && reason.startsWith(text))
    .sort((a, b) => b.text!.length - a.text!.length);
  const [first, second] = sources;
  if (!first || (second && second.text!.length === first.text!.length)) {
    return undefined;
  }
  return first.child;
};

/**
 * The decision the runner returned for the step: the root's, or, when a
 * `decide_final()` bypassed the root, the one recorded after the bypassed layers.
 */
const outcomeOf = (nodes: SentinelNode[]): SentinelNode | undefined => {
  const root = nodes.find(
    (n) => n.event.path === "" && reported(n, "decision")
  );
  if (root) return root;
  const bypassed = nodes.findIndex(
    (n) => n.event.path === "" && n.event.status === "bypassed"
  );
  if (bypassed === -1) return undefined;
  return nodes.slice(bypassed + 1).findLast((n) => reported(n, "decision"));
};

const isInactive = (
  status: SentinelEvent["status"]
): status is InactiveStatus => status !== "reported";

/**
 * The verdict of a step the runner returned no decision for: observed when
 * only monitors reported, proceeded when a protocol reported but the root
 * returned nothing, and the recorded status when the root or every check was
 * cancelled or bypassed.
 */
const quietVerdict = (checks: SentinelNode[]): SentinelVerdict => {
  const rootStatus = checks.find((n) => n.event.path === "")?.event.status;
  if (rootStatus && isInactive(rootStatus)) return rootStatus;
  if (checks.some((n) => reported(n, "decision"))) return "proceed";
  if (checks.some((n) => reported(n, "observation"))) return "observe";
  const firstStatus = checks[0]?.event.status;
  return firstStatus && isInactive(firstStatus) ? firstStatus : "proceed";
};

/**
 * Builds the check tree for one step's events, given in recording order. A
 * decision that a later `superseded` event names shares that event's row.
 */
export function buildSentinelStep(
  nodes: SentinelNode[],
  modelCalls: EventNode<ModelEvent>[] = []
): SentinelStep {
  const first = nodes[0];
  const replaced = new Set<SentinelNode>();
  /** Decisions not yet superseded, by the layer and function that made them. */
  const standing = new Map<string, SentinelNode[]>();
  for (const node of nodes) {
    const fn = node.event.function;
    const key = `${node.event.path}\u0000${fn == null ? String(fn) : `:${fn}`}`;
    if (node.event.status === "superseded") {
      for (const report of standing.get(key) ?? []) replaced.add(report);
      standing.delete(key);
    } else if (reported(node, "decision")) {
      const reports = standing.get(key);
      if (reports) reports.push(node);
      else standing.set(key, [node]);
    }
  }
  const checks = nodes.filter((n) => !replaced.has(n));
  const tree = buildTree(checks);

  const outcome = outcomeOf(checks);
  const acted = !!outcome && outcome.event.action !== "proceed";
  const credit = acted ? creditDecision(tree, outcome) : undefined;
  const effective = credit?.node;

  const single = checks.length === 1 ? checks[0] : undefined;
  const observations = checks.filter(
    (n) => reported(n, "observation") && n.event.suspicion != null
  );
  const scores = acted
    ? []
    : single?.event.suspicion != null
      ? [formatSuspicion(single.event.suspicion)].filter(Boolean)
      : observations.flatMap((n) => {
          const top = topScore(n.event.suspicion!);
          if (!top.value) return [];
          return [
            `${top.dimension ?? n.event.factory.split("/").at(-1)} ${top.value}`,
          ];
        });

  return {
    id: first?.id ?? "",
    stage: first?.event.stage ?? "tool_call",
    stepId: first?.event.step_id ?? "",
    executionId: first?.event.execution_id ?? undefined,
    rows: tree.map((entry) => ({
      node: entry.node,
      depth: entry.depth,
      guides: guidesFor(entry),
      tookEffect: entry.node === effective,
    })),
    verdict: outcome
      ? (outcome.event.action ?? "proceed")
      : quietVerdict(checks),
    outcome,
    returned: !!outcome,
    decider: effective ?? outcome,
    effective,
    reason: credit ? credit.reason : explanationOf(single),
    error: single?.event.error || undefined,
    reasonReferences: credit
      ? (credit.reasonSource?.event.references ?? [])
      : explanationOf(single)
        ? single!.event.references
        : [],
    scores,
    audit: nodes.some((n) => n.event.audit),
    failed: checks.filter((n) => n.event.status === "error").length,
    modelCalls,
  };
}

/**
 * The step of one event shown without the rest of its step (e.g. in the
 * chunked transcript), whose verdict is the event's own result.
 */
export function buildLoneSentinelStep(node: SentinelNode): SentinelStep {
  const step = buildSentinelStep([node]);
  const event = node.event;
  if (!reported(node, "decision") || step.outcome) return step;
  const verdict = event.action ?? "proceed";
  const acted = verdict !== "proceed";
  return {
    ...step,
    verdict,
    outcome: node,
    returned: event.path === "",
    decider: node,
    effective: acted ? node : undefined,
    rows: step.rows.map((row) => ({ ...row, tookEffect: acted })),
    reason: explanationOf(node),
    reasonReferences: explanationOf(node) ? event.references : [],
  };
}

/**
 * The steps of a flat event list, keyed by the first event each recorded, in
 * recording order. The events of one sentinel span form a step. Events
 * outside a span group by conversation, stage and step id, and a step id the
 * conversation reuses starts a new step once the root has reported for the
 * earlier one. A node's id is its event's uuid, or `evt:<index>` in `events`
 * without one.
 */
export function buildSentinelSteps(
  events: Event[]
): Map<SentinelEvent, SentinelStep> {
  const sentinelSpans = new Set<string>();
  for (const event of events) {
    if (event.event === SPAN_BEGIN && event.type === TYPE_SENTINEL) {
      sentinelSpans.add(event.id);
    }
  }
  const groups: SentinelNode[][] = [];
  const bySpan = new Map<string, SentinelNode[]>();
  /** The latest spanless step per key, and whether its root has reported. */
  const spanless = new Map<string, { nodes: SentinelNode[]; done: boolean }>();
  events.forEach((event, index) => {
    if (event.event !== "sentinel") return;
    const node = new EventNode(event.uuid ?? `evt:${index}`, event, 0);
    if (event.span_id && sentinelSpans.has(event.span_id)) {
      let nodes = bySpan.get(event.span_id);
      if (!nodes) {
        bySpan.set(event.span_id, (nodes = []));
        groups.push(nodes);
      }
      nodes.push(node);
      return;
    }
    const key = `${event.conversation}\u0000${event.stage}\u0000${executionIdOf(event)}`;
    let step = spanless.get(key);
    // A superseded record names a decision already recorded, so it never
    // starts a step.
    if (!step || (step.done && event.status !== "superseded")) {
      step = { nodes: [], done: false };
      spanless.set(key, step);
      groups.push(step.nodes);
    }
    step.nodes.push(node);
    if (
      event.path === "" &&
      event.status !== "bypassed" &&
      event.status !== "superseded"
    ) {
      step.done = true;
    }
  });
  return new Map(
    groups.map((nodes) => [nodes[0]!.event, buildSentinelStep(nodes)])
  );
}

/** Where in the tree's conversations (`isConversationNode`) an event sits. */
interface Conversation {
  /** The opening node's id, or "" outside any. */
  key: string;
  /** The id of the span that opened it, which a check's `conversation` names. */
  spanId?: string;
  parent?: Conversation;
}

const kRootConversation: Conversation = { key: "" };

interface SentinelSpan {
  node: EventNode;
  /** The sentinel span this one is nested in. */
  parent?: SentinelSpan;
  /** The conversation the span sits in. */
  conversation: Conversation;
  /** Every event nested in the span. */
  members: EventNode[];
  modelCalls: EventNode<ModelEvent>[];
  /** Position of the span in recording order. */
  order: number;
}

/**
 * The calls a sentinel span's monitors and approvers make run inside it, so
 * the nearest enclosing sentinel span ("" outside any) keeps them apart from
 * the agent's calls, whose ids they may share.
 */
const scopeOf = (span: SentinelSpan | undefined): string => span?.node.id ?? "";

/** The sentinel events of one step, with where the step sits in recording order. */
interface StepEvents {
  nodes: SentinelNode[];
  /** Position of the step's span, or of its first event, in recording order. */
  order: number;
  span?: SentinelSpan;
  /** The scope of the calls the step judges: the one its span is in. */
  scope: string;
  /** The conversation the step's span, or its first event, sits in. */
  conversation: Conversation;
}

interface ToolEntry {
  node: EventNode<ToolEvent>;
  order: number;
  scope: string;
  /** The key of the conversation the tool sits in. */
  conversation: string;
  /** The key of the calls proposed under its id; unset for a call made inside a sentinel span, which no agent output proposed. */
  proposals?: string;
}

const kToolStages: ReadonlySet<SentinelEvent["stage"]> = new Set([
  "tool_call",
  "tool_result",
]);

/**
 * The conversation of the calls a step judges: the one its span sits in, or
 * for an agent bridge's check routed out of it, the one it recorded. A model
 * event sink can run a bridged generation, and the host calls it makes, in a
 * sub-agent while the check's span stays under the outer agent. The recorded
 * conversation is the nearest agent span, so it decides only when the check
 * sits outside it, which keeps a check under a subtask with the subtask's
 * calls (as `bridgeConversationSpan` in sample-activity/activityData.ts).
 */
const conversationOfStep = (
  { nodes, conversation }: StepEvents,
  bridge: boolean,
  bySpan: Map<string, Conversation>
): string => {
  const recorded = nodes[0]?.event.conversation;
  if (!bridge || recorded === undefined) return conversation.key;
  for (let c: Conversation | undefined = conversation; c; c = c.parent) {
    if (c.spanId === recorded) return conversation.key;
  }
  return bySpan.get(recorded)?.key ?? conversation.key;
};

/** The tools a step may judge, by `runKey` of their id and of `runIdOf`. */
interface ToolIndex {
  toolsById: Map<string, ToolEntry[]>;
  toolsByExecution: Map<string, ToolEntry[]>;
}

/** Keys the tools a step may judge: by id, scope, conversation and whether a bridge ran them on the host. */
const runKey = (
  id: string,
  scope: string,
  conversation: string,
  bridge: boolean
): string =>
  `${id}\u0000${scope}\u0000${conversation}\u0000${bridge ? "host" : "native"}`;

/**
 * The ToolEvent a tool-stage step judged, among those in the step's scope
 * and conversation, skipping tools that already host a step of the same
 * stage. A bridge's check judges only a call the bridge ran on the host, and
 * a native check only a native call, though they share ids (a call the
 * bridged agent inherited, for example).
 *
 * A step that records its `execution_id` names its runs (`runIdOf`,
 * `toolsByExecution`). One handout of a bridged call runs once per bridged
 * tool it denotes, and the bridge checks it once per tool, so a step takes
 * the first such run no step of its stage holds yet. A step whose
 * `execution_id` is a ToolEvent's own id (a log from before ToolEvents
 * recorded it) names the one such tool, or none. Otherwise the step's id is
 * the model's, and it judged a run under that id (`toolsById`):
 * - A bridge hands over only a call nothing stopped, and records no
 *   `execution_id` for an attempt it never handed over, so a bridge step
 *   with none judged the one run under the model's id, in any recording
 *   order, or none. One its check stopped judged no run: a rejected
 *   attempt's check precedes the accepted retry's run under the same id.
 *   Nor did a `tool_call` check of an output the bridge discarded
 *   (`discarded`, see `BridgeOutputs`), whatever it decided.
 * - Each native attempt records its ToolEvent, a stopped one as failed, so
 *   native steps pair in order: a `tool_call` step judges the first such
 *   tool recorded after it (none when no such tool follows), a
 *   `tool_result` step the last one before it.
 */
const hostTool = (
  { toolsById, toolsByExecution }: ToolIndex,
  step: SentinelStep,
  { order, scope }: StepEvents,
  conversation: string,
  claimed: Set<string>,
  bridge: boolean,
  discarded: boolean
): ToolEntry | undefined => {
  const unclaimed = (t: ToolEntry) =>
    !claimed.has(`${step.stage}\u0000${t.node.id}`);
  const sole = (candidates: ToolEntry[]) => {
    const [only, other] = candidates;
    return only && !other && unclaimed(only) ? only : undefined;
  };
  if (step.executionId !== undefined) {
    const runs =
      toolsByExecution.get(
        runKey(step.executionId, scope, conversation, bridge)
      ) ?? [];
    return runs[0]?.node.event.execution_id != null
      ? runs.find(unclaimed)
      : sole(runs);
  }
  const candidates =
    toolsById.get(runKey(step.stepId, scope, conversation, bridge)) ?? [];
  const stopped = step.stage === "tool_call" && stopsCall(step);
  if (bridge) return stopped || discarded ? undefined : sole(candidates);
  const open = candidates.filter(
    (t) => unclaimed(t) && (!stopped || toolFailed(t.node.event))
  );
  const after = open.find((t) => t.order > order);
  if (step.stage === "tool_call") return after;
  return open.findLast((t) => t.order < order) ?? after;
};

/**
 * Groups SentinelEvents by the step they judged and pairs tool-stage steps to
 * their ToolEvent, so the tool panel renders them inline. A sample whose log
 * records `execution_id` (`recordsExecutionIds`) pairs by execution
 * (`pairToolSentinelsByExecution`); any other pairs exactly as before the
 * field (`pairToolSentinelsLegacy`). Callers that render part of a sample
 * pass the sample's answer, so every view of it pairs the same way.
 */
export function pairToolSentinels(
  eventNodes: EventNode[],
  recordsExecutions: boolean = treeRecordsExecutionIds(eventNodes)
): ToolSentinelPairing {
  return recordsExecutions
    ? pairToolSentinelsByExecution(eventNodes)
    : pairToolSentinelsLegacy(eventNodes);
}

/**
 * Pairs tool-stage steps to their ToolEvent (`executionIdOf` ==
 * `runIdOf`, see `hostTool`), so the
 * tool panel renders them inline. Each sentinel span holds one step; events
 * outside a span group by conversation, stage and execution id. Steps with no tool render
 * as one row at their span or first event. A tool shows the call it ran as
 * proposed under its `proposalIdOf` in its conversation, when nothing could
 * be confused (`findProposal`).
 * Proposals, approvals and steps pair only within a conversation
 * (`isConversationNode`), since agents reuse each other's call ids.
 *
 * The Activity view pairs the same way in `collectSentinelDecisions`
 * (sample-activity/activityData.ts), over the flat event list; a change to
 * these pairing rules belongs in both.
 */
function pairToolSentinelsByExecution(
  eventNodes: EventNode[]
): ToolSentinelPairing {
  const tools: ToolEntry[] = [];
  // By conversation and call id, the calls model outputs outside sentinel
  // spans proposed, for the tools outside sentinel spans.
  const proposals: ProposalIndex<undefined> = new Map();
  // The same, of outputs other than a bridge's generations, whose calls only
  // its scaffold runs: a native run's.
  const nativeProposals: ProposalIndex<undefined> = new Map();
  // By conversation and execution id, the approvals outside sentinel spans.
  const approvals = new Map<string, ApprovalEvent[]>();
  const outputs = bridgeOutputs();
  const conversationKey = (conversation: Conversation, id: string) =>
    `${conversation.key}\u0000${id}`;
  const steps = new Map<string, StepEvents>();
  const conversationsBySpan = new Map<string, Conversation>();
  const seen = new Set<string>();
  let order = 0;
  const walk = (
    nodes: EventNode[],
    span: SentinelSpan | undefined,
    conversation: Conversation
  ) => {
    for (const n of nodes) {
      // Flat lists repeat descendants alongside their ancestors.
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      const at = order++;
      span?.members.push(n);
      if (n.event.event === "tool") {
        tools.push({
          node: eventNodeOf(n, "tool"),
          order: at,
          scope: scopeOf(span),
          conversation: conversation.key,
          proposals: span
            ? undefined
            : conversationKey(conversation, proposalIdOf(n.event)),
        });
      } else if (n.event.event === "approval") {
        if (!span) {
          const key = conversationKey(conversation, executionIdOf(n.event));
          const recorded = approvals.get(key) ?? [];
          recorded.push(n.event);
          approvals.set(key, recorded);
        }
      } else if (n.event.event === "sentinel") {
        const key = span
          ? span.node.id
          : `${conversation.key}\u0000${n.event.stage}\u0000${executionIdOf(n.event)}`;
        const step = steps.get(key) ?? {
          nodes: [],
          order: span?.order ?? at,
          span,
          scope: scopeOf(span?.parent),
          conversation: span?.conversation ?? conversation,
        };
        step.nodes.push(eventNodeOf(n, "sentinel"));
        steps.set(key, step);
      } else if (n.event.event === "model") {
        if (span) {
          span.modelCalls.push(eventNodeOf(n, "model"));
        } else {
          const proposed = n.event.output.choices.flatMap(
            (choice) => choice.message.tool_calls ?? []
          );
          for (const call of proposed) {
            const key = conversationKey(conversation, call.id);
            addProposal(proposals, key, call, undefined, at);
            if (!n.event.requested_model) {
              addProposal(nativeProposals, key, call, undefined, at);
            }
          }
          outputs.propose(
            conversation.key,
            n.id,
            !!n.event.requested_model,
            proposed.map((call) => call.id),
            at
          );
        }
      }
      let inner = span;
      if (isSentinelSpan(n)) {
        inner = {
          node: n,
          parent: span,
          conversation,
          members: [],
          modelCalls: [],
          order: at,
        };
      }
      let innerConversation = conversation;
      if (isConversationNode(n)) {
        const spanId = n.event.event === SPAN_BEGIN ? n.event.id : undefined;
        innerConversation = { key: n.id, spanId, parent: conversation };
        if (spanId !== undefined) {
          conversationsBySpan.set(spanId, innerConversation);
        }
      }
      if (n.children.length) walk(n.children, inner, innerConversation);
    }
  };
  walk(eventNodes, undefined, kRootConversation);

  const toolSentinels = new Map<string, ToolSentinels>();
  const standaloneSentinels = new Map<string, SentinelStep>();
  const hiddenSentinelIds = new Set<string>();
  const sentinelScrollRedirects = new Map<string, string>();
  const claimed = new Set<string>();
  const toolIndex: ToolIndex = {
    toolsById: new Map(),
    toolsByExecution: new Map(),
  };
  const index = (
    byKey: Map<string, ToolEntry[]>,
    id: string,
    entry: ToolEntry
  ) => {
    const key = runKey(
      id,
      entry.scope,
      entry.conversation,
      isBridgeTool(entry.node.event)
    );
    const runs = byKey.get(key);
    if (runs) runs.push(entry);
    else byKey.set(key, [entry]);
  };
  for (const entry of tools) {
    index(toolIndex.toolsById, entry.node.event.id, entry);
    index(toolIndex.toolsByExecution, runIdOf(entry.node.event), entry);
  }

  // Every step is built before any pairs, since a later sibling's check can
  // discard the output an earlier step judged a call of. An approval that
  // rejects discards its output before any of its checks run, so only a
  // check discards one here.
  const built = [...steps.values()]
    .sort((a, b) => a.order - b.order)
    .map((events) => {
      const step = buildSentinelStep(events.nodes, events.span?.modelCalls);
      const bridge =
        events.span?.node.event.event === SPAN_BEGIN &&
        events.span.node.event.name === kBridgeCheckSpan;
      const conversation = conversationOfStep(
        events,
        bridge,
        conversationsBySpan
      );
      const output =
        bridge && step.stage === "tool_call" && step.executionId === undefined
          ? outputs.outputOf(conversation, step.stepId, events.order)
          : undefined;
      if (stopsCall(step)) outputs.discard(output);
      return { events, step, bridge, conversation, output };
    });
  for (const { events, step, bridge, conversation, output } of built) {
    const { nodes, span } = events;
    const tool = kToolStages.has(step.stage)
      ? hostTool(
          toolIndex,
          step,
          events,
          conversation,
          claimed,
          bridge,
          outputs.discarded(output)
        )
      : undefined;
    const hostId = tool?.node.id ?? span?.node.id ?? nodes[0]!.id;
    if (tool) {
      claimed.add(`${step.stage}\u0000${tool.node.id}`);
      const paired = toolSentinels.get(tool.node.id) ?? {};
      if (step.stage === "tool_call") paired.before = step;
      else paired.after = step;
      toolSentinels.set(tool.node.id, paired);
    } else {
      standaloneSentinels.set(hostId, step);
    }
    const hidden = span ? [span.node, ...span.members] : nodes;
    for (const node of hidden) {
      if (node.id === hostId) continue;
      hiddenSentinelIds.add(node.id);
      sentinelScrollRedirects.set(node.id, hostId);
    }
  }

  // An approval names a run's proposal only when its `execution_id` joins
  // it to that run alone.
  const runsById = new Map<string, number>();
  for (const { node, conversation, proposals: key } of tools) {
    if (key === undefined) continue;
    const runKey = `${conversation}\u0000${runIdOf(node.event)}`;
    runsById.set(runKey, (runsById.get(runKey) ?? 0) + 1);
  }
  for (const { node, order: at, conversation, proposals: key } of tools) {
    const paired = toolSentinels.get(node.id);
    if (key === undefined || !paired) continue;
    const tool = node.event;
    const runKey = `${conversation}\u0000${runIdOf(tool)}`;
    const index = isBridgeTool(tool) ? proposals : nativeProposals;
    const found = findProposal(index.get(key), {
      tool,
      approvals:
        runsById.get(runKey) === 1 ? (approvals.get(runKey) ?? []) : [],
      order: at,
    });
    if (found) paired.proposed = found.call;
  }

  return {
    toolSentinels,
    standaloneSentinels,
    hiddenSentinelIds,
    sentinelScrollRedirects,
  };
}

// Logs that record no `execution_id` pair with origin/main's rules, kept
// verbatim below (renamed) so their transcripts render as they always have.

interface LegacySentinelSpan {
  node: EventNode;
  /** Every event nested in the span. */
  members: EventNode[];
  modelCalls: EventNode<ModelEvent>[];
  /** Position of the span in recording order. */
  order: number;
}

/** The sentinel events of one step, with where the step sits in recording order. */
interface LegacyStepEvents {
  nodes: SentinelNode[];
  /** Position of the step's span, or of its first event, in recording order. */
  order: number;
  span?: LegacySentinelSpan;
}

interface LegacyToolEntry {
  node: EventNode<ToolEvent>;
  order: number;
  proposed?: ToolCall;
}

/**
 * The ToolEvent a tool-stage step judged: the first one with the step's id
 * recorded after a `tool_call` step (none when no such tool follows), the last
 * one before a `tool_result` step, skipping tools that already host a step of
 * the same stage. A bridge's check judges only a call the bridge ran on the
 * host: a native call under the same id (one the bridged agent inherited, for
 * example) is not the one it checked.
 */
const legacyHostTool = (
  tools: LegacyToolEntry[],
  step: SentinelStep,
  order: number,
  claimed: Set<string>,
  bridge: boolean
): LegacyToolEntry | undefined => {
  const candidates = tools.filter(
    (t) =>
      t.node.event.id === step.stepId &&
      (!bridge || isBridgeTool(t.node.event)) &&
      !claimed.has(`${step.stage}\u0000${t.node.id}`)
  );
  const after = candidates.find((t) => t.order > order);
  if (step.stage === "tool_call") return after;
  return candidates.findLast((t) => t.order < order) ?? after;
};

/**
 * Groups SentinelEvents by the step they judged and pairs tool-stage steps to
 * their ToolEvent (`step_id == ToolEvent.id`), so the tool panel renders them
 * inline. Each sentinel span holds one step; events outside a span group by
 * stage and step id. Steps with no tool render as one row at their span or
 * first event.
 *
 * The Activity view pairs the same way in `collectSentinelDecisionsLegacy`
 * (sample-activity/activityData.ts), over the flat event list.
 */
function pairToolSentinelsLegacy(eventNodes: EventNode[]): ToolSentinelPairing {
  const tools: LegacyToolEntry[] = [];
  // The proposals of each call id in the latest model output (outside
  // sentinel spans) that proposed it, which its tools take in order.
  const proposals = new Map<string, ToolCall[]>();
  const steps = new Map<string, LegacyStepEvents>();
  const seen = new Set<string>();
  let order = 0;
  const walk = (nodes: EventNode[], span: LegacySentinelSpan | undefined) => {
    for (const n of nodes) {
      // Flat lists repeat descendants alongside their ancestors.
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      const at = order++;
      span?.members.push(n);
      if (n.event.event === "tool") {
        tools.push({
          node: eventNodeOf(n, "tool"),
          order: at,
          proposed: proposals.get(n.event.id)?.shift(),
        });
      } else if (n.event.event === "sentinel") {
        const key = span
          ? span.node.id
          : `${n.event.stage}\u0000${n.event.step_id}`;
        const step = steps.get(key) ?? {
          nodes: [],
          order: span?.order ?? at,
          span,
        };
        step.nodes.push(eventNodeOf(n, "sentinel"));
        steps.set(key, step);
      } else if (n.event.event === "model") {
        if (span) {
          span.modelCalls.push(eventNodeOf(n, "model"));
        } else {
          const proposed = n.event.output.choices.flatMap(
            (choice) => choice.message.tool_calls ?? []
          );
          for (const id of new Set(proposed.map((call) => call.id))) {
            proposals.set(
              id,
              proposed.filter((call) => call.id === id)
            );
          }
        }
      }
      let inner = span;
      if (isSentinelSpan(n)) {
        inner = { node: n, members: [], modelCalls: [], order: at };
      }
      if (n.children.length) walk(n.children, inner);
    }
  };
  walk(eventNodes, undefined);

  const toolSentinels = new Map<string, ToolSentinels>();
  const standaloneSentinels = new Map<string, SentinelStep>();
  const hiddenSentinelIds = new Set<string>();
  const sentinelScrollRedirects = new Map<string, string>();
  const claimed = new Set<string>();

  const ordered = [...steps.values()].sort((a, b) => a.order - b.order);
  for (const { nodes, order: at, span } of ordered) {
    const step = buildSentinelStep(nodes, span?.modelCalls);
    const bridge =
      span?.node.event.event === SPAN_BEGIN &&
      span.node.event.name === kBridgeCheckSpan;
    const tool = kToolStages.has(step.stage)
      ? legacyHostTool(tools, step, at, claimed, bridge)
      : undefined;
    const hostId = tool?.node.id ?? span?.node.id ?? nodes[0]!.id;
    if (tool) {
      claimed.add(`${step.stage}\u0000${tool.node.id}`);
      const paired = toolSentinels.get(tool.node.id) ?? {
        proposed: tool.proposed,
      };
      if (step.stage === "tool_call") paired.before = step;
      else paired.after = step;
      toolSentinels.set(tool.node.id, paired);
    } else {
      standaloneSentinels.set(hostId, step);
    }
    const hidden = span ? [span.node, ...span.members] : nodes;
    for (const node of hidden) {
      if (node.id === hostId) continue;
      hiddenSentinelIds.add(node.id);
      sentinelScrollRedirects.set(node.id, hostId);
    }
  }

  return {
    toolSentinels,
    standaloneSentinels,
    hiddenSentinelIds,
    sentinelScrollRedirects,
  };
}

/** The instance path, or the factory's registry name at the root. */
export const instanceLabel = (event: SentinelEvent): string =>
  event.path || event.factory;

export const formatSuspicion = (
  suspicion: NonNullable<SentinelEvent["suspicion"]>
): string => {
  if (typeof suspicion === "number") return formatScore(suspicion);
  return Object.entries(suspicion)
    .map(([dimension, value]) => `${dimension} ${formatScore(value)}`)
    .join(", ");
};

const formatScore = (value: number): string =>
  String(Math.round(value * 100) / 100);

export interface TopScore {
  /** The score's dimension; unset for a single-number suspicion. */
  dimension?: string;
  value: string;
  /** How many other dimensions the suspicion scored. */
  more: number;
}

/** The highest score of a suspicion, which stands for it where space is short; an empty value for a suspicion with no scores. */
export const topScore = (
  suspicion: NonNullable<SentinelEvent["suspicion"]>
): TopScore => {
  if (typeof suspicion === "number") {
    return { value: formatScore(suspicion), more: 0 };
  }
  const top = sortedScores(suspicion)[0];
  if (!top) return { value: "", more: 0 };
  const [dimension, value] = top;
  return {
    dimension,
    value: formatScore(value),
    more: Object.keys(suspicion).length - 1,
  };
};

/** A suspicion's dimensions, highest score first. */
export const sortedScores = (
  suspicion: Record<string, number>
): [string, number][] =>
  Object.entries(suspicion).sort(([, a], [, b]) => b - a);

/** A modify decision's replacement call, with every argument spelled out. */
export const formatModifiedCall = (
  call: NonNullable<SentinelEvent["modified"]>
): string =>
  `${call.function}(${Object.entries(call.arguments)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(", ")})`;
