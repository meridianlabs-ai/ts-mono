import type {
  ModelEvent,
  Reference,
  SentinelEvent,
  ToolCall,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { eventNodeOf } from "../types";
import type { EventNode } from "../types";

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
  /** The check that made the step's decision; unset when every check continued. */
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

const isAncestorPath = (ancestor: string, path: string): boolean =>
  ancestor === "" ? path !== "" : path.startsWith(`${ancestor}/`);

/**
 * Orders a step's events so a nested configuration reads top to bottom: each
 * layer above its children, siblings in the order they were first recorded.
 */
const pathOrderKeys = (nodes: SentinelNode[]): Map<SentinelNode, number[]> => {
  const firstSeen = new Map<string, number>();
  nodes.forEach((node, index) => {
    const segments = pathSegments(node.event.path);
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join("/");
      if (!firstSeen.has(prefix)) firstSeen.set(prefix, index);
    }
  });
  const keys = new Map<SentinelNode, number[]>();
  for (const node of nodes) {
    const segments = pathSegments(node.event.path);
    keys.set(
      node,
      segments.map((_, i) => firstSeen.get(segments.slice(0, i + 1).join("/"))!)
    );
  }
  return keys;
};

const compareKeys = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
};

interface TreeNode {
  node: SentinelNode;
  parent?: TreeNode;
  children: TreeNode[];
  depth: number;
}

/** Links each check to the nearest recorded check above it by path. */
const buildTree = (ordered: SentinelNode[]): TreeNode[] => {
  const tree: TreeNode[] = [];
  for (const node of ordered) {
    const parent = tree.findLast((candidate) =>
      isAncestorPath(candidate.node.event.path, node.event.path)
    );
    const entry: TreeNode = {
      node,
      parent,
      children: [],
      depth: parent ? parent.depth + 1 : 0,
    };
    parent?.children.push(entry);
    tree.push(entry);
  }
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
 * only monitors reported, continued when a protocol reported but the root
 * returned nothing, and the recorded status when the root or every check was
 * cancelled or bypassed.
 */
const quietVerdict = (checks: SentinelNode[]): SentinelVerdict => {
  const rootStatus = checks.find((n) => n.event.path === "")?.event.status;
  if (rootStatus && isInactive(rootStatus)) return rootStatus;
  if (checks.some((n) => reported(n, "decision"))) return "continue";
  if (checks.some((n) => reported(n, "observation"))) return "observe";
  const firstStatus = checks[0]?.event.status;
  return firstStatus && isInactive(firstStatus) ? firstStatus : "continue";
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
  nodes.forEach((loser, at) => {
    if (loser.event.status !== "superseded") return;
    for (const report of nodes.slice(0, at)) {
      if (
        reported(report, "decision") &&
        report.event.path === loser.event.path &&
        report.event.function === loser.event.function
      ) {
        replaced.add(report);
      }
    }
  });
  const checks = nodes.filter((n) => !replaced.has(n));

  const keys = pathOrderKeys(checks);
  const ordered = checks
    .map((node, index) => ({ node, index }))
    .sort(
      (a, b) =>
        compareKeys(keys.get(a.node)!, keys.get(b.node)!) || a.index - b.index
    )
    .map(({ node }) => node);
  const tree = buildTree(ordered);

  const outcome = outcomeOf(checks);
  const acted = !!outcome && outcome.event.action !== "continue";
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
      ? (outcome.event.action ?? "continue")
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
  const verdict = event.action ?? "continue";
  const acted = verdict !== "continue";
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
