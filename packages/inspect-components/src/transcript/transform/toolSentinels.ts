import type {
  Event,
  ModelEvent,
  Reference,
  SentinelEvent,
  ToolCall,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { EventNode, eventNodeOf } from "../types";

import { SPAN_BEGIN, TYPE_SENTINEL } from "./utils";

export type SentinelNode = EventNode<SentinelEvent>;

/** The span a sentinel's dispatch runs in; it holds the step's events and the model calls its monitors made. */
export const isSentinelSpan = (node: EventNode): boolean =>
  node.event.event === SPAN_BEGIN && node.event.type === TYPE_SENTINEL;

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
  /** The call as the model proposed it, from the last model output before the tool that proposed its id; calls that share an id take its proposals in order. */
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
    const key = `${event.conversation}\u0000${event.stage}\u0000${event.step_id}`;
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

interface SentinelSpan {
  node: EventNode;
  /** Every event nested in the span. */
  members: EventNode[];
  modelCalls: EventNode<ModelEvent>[];
  /** Position of the span in recording order. */
  order: number;
}

/** The sentinel events of one step, with where the step sits in recording order. */
interface StepEvents {
  nodes: SentinelNode[];
  /** Position of the step's span, or of its first event, in recording order. */
  order: number;
  span?: SentinelSpan;
}

interface ToolEntry {
  node: EventNode<ToolEvent>;
  order: number;
  proposed?: ToolCall;
}

const kToolStages: ReadonlySet<SentinelEvent["stage"]> = new Set([
  "tool_call",
  "tool_result",
]);

/**
 * The ToolEvent a tool-stage step judged: the first one with the step's id
 * recorded after a `tool_call` step (none when no such tool follows), the last
 * one before a `tool_result` step, skipping tools that already host a step of
 * the same stage.
 */
const hostTool = (
  tools: ToolEntry[],
  step: SentinelStep,
  order: number,
  claimed: Set<string>
): ToolEntry | undefined => {
  const candidates = tools.filter(
    (t) =>
      t.node.event.id === step.stepId &&
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
 * The Activity view pairs the same way in `collectSentinelDecisions`
 * (sample-activity/activityData.ts), over the flat event list; a change to
 * these pairing rules belongs in both.
 */
export function pairToolSentinels(
  eventNodes: EventNode[]
): ToolSentinelPairing {
  const tools: ToolEntry[] = [];
  // The proposals of each call id in the latest model output (outside
  // sentinel spans) that proposed it, which its tools take in order.
  const proposals = new Map<string, ToolCall[]>();
  const steps = new Map<string, StepEvents>();
  const seen = new Set<string>();
  let order = 0;
  const walk = (nodes: EventNode[], span: SentinelSpan | undefined) => {
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
    const tool = kToolStages.has(step.stage)
      ? hostTool(tools, step, at, claimed)
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
