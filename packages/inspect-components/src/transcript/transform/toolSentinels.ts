import type { ModelEvent, SentinelEvent } from "@tsmono/inspect-common/types";

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
  /** Whether this is the decision that took effect for the step. */
  tookEffect: boolean;
}

export type SentinelVerdict =
  "observe" | NonNullable<SentinelEvent["decision"]>;

/** The sentinel events recorded for one step, as a tree of checks. */
export interface SentinelStep {
  /** The id of the step's first event, which keys the step's view state. */
  id: string;
  stage: SentinelEvent["stage"];
  stepId: string;
  /** One row per check in tree order; a superseded event stands in for the decision it names. */
  rows: SentinelRow[];
  verdict: SentinelVerdict;
  /** The check the summary names: the decision that took effect, or the top decision of a quiet step. */
  decider?: SentinelNode;
  /** The row that took effect; unset when every check continued. */
  effective?: SentinelNode;
  /** The explanation the summary shows: the deciding layer's, or the lone check's. */
  reason?: string;
  /** Scores the summary shows for a quiet step: each monitor's first score. */
  scores: string[];
  /** Whether any event of the step asked for an audit. */
  audit: boolean;
  /** Model calls made inside the step's sentinel span, in recording order. */
  modelCalls: EventNode<ModelEvent>[];
}

export interface ToolSentinels {
  before?: SentinelStep;
  after?: SentinelStep;
}

export interface ToolSentinelPairing {
  /** Tool call id → the steps rendered inside that tool's panel. */
  toolSentinels: Map<string, ToolSentinels>;
  /** Host node id → a step with no tool to render in; the host is the step's first event. */
  standaloneSentinels: Map<string, SentinelStep>;
  /** Sentinel node ids with no row of their own. */
  hiddenSentinelIds: Set<string>;
  /** Hidden sentinel node id → the node that renders it. */
  sentinelScrollRedirects: Map<string, string>;
}

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

/**
 * The decision that took effect, inferred from the recorded decisions: the
 * runner records the deciding layer's decision last, and a parent passes up
 * its children's decision, so descend from it through children that made the
 * same decision. A child whose explanation matches the parent's wins a tie.
 */
const effectiveDecision = (
  tree: TreeNode[],
  last: SentinelNode
): SentinelNode => {
  let current = tree.find((e) => e.node === last)!;
  for (;;) {
    const matching = current.children.filter(
      (c) =>
        c.node.event.kind === "decision" &&
        c.node.event.decision === current.node.event.decision
    );
    const explanation = current.node.event.explanation?.trim() || null;
    const next =
      matching.find(
        (c) => (c.node.event.explanation?.trim() || null) === explanation
      ) ?? matching[0];
    if (!next) return current.node;
    current = next;
  }
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
    if (loser.event.kind !== "superseded") return;
    for (const report of nodes.slice(0, at)) {
      if (
        report.event.kind === "decision" &&
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

  const decisions = checks.filter((n) => n.event.kind === "decision");
  const last = decisions.at(-1);
  const acted = last && last.event.decision !== "continue";
  const effective = acted ? effectiveDecision(tree, last) : undefined;
  const onlyRootDecides = decisions.every((n) => n.event.path === "");
  const observed =
    !acted &&
    onlyRootDecides &&
    checks.some((n) => n.event.kind === "observation");

  const explanationOf = (node: SentinelNode | undefined) =>
    node?.event.explanation?.trim() || undefined;
  const single = checks.length === 1 ? checks[0] : undefined;
  const observations = checks.filter(
    (n) => n.event.kind === "observation" && n.event.suspicion != null
  );
  const scores = acted
    ? []
    : single?.event.suspicion != null
      ? [formatSuspicion(single.event.suspicion)]
      : observations.map((n) => {
          const top = topScore(n.event.suspicion!);
          return `${top.dimension ?? n.event.name.split("/").at(-1)} ${top.value}`;
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
    verdict: observed ? "observe" : (last?.event.decision ?? "continue"),
    decider: effective ?? last,
    effective,
    reason: acted
      ? (explanationOf(effective) ?? explanationOf(last))
      : explanationOf(single),
    scores,
    audit: nodes.some((n) => n.event.audit),
    modelCalls,
  };
}

interface SentinelSpan {
  node: EventNode;
  /** Every event nested in the span. */
  members: EventNode[];
  modelCalls: EventNode<ModelEvent>[];
  /** The step of the span's first sentinel event. */
  stepKey?: string;
}

const kToolStages: ReadonlySet<SentinelEvent["stage"]> = new Set([
  "tool_call",
  "tool_result",
]);

/**
 * Groups SentinelEvents by the step they judged and pairs tool-stage steps to
 * their ToolEvent (`step_id == ToolEvent.id`), so the tool panel renders them
 * inline. Steps with no tool render as one row at their first event.
 */
export function pairToolSentinels(
  eventNodes: EventNode[]
): ToolSentinelPairing {
  const toolNodeIdsByCallId = new Map<string, string>();
  const steps = new Map<string, SentinelNode[]>();
  const spans: SentinelSpan[] = [];
  const seen = new Set<string>();
  const walk = (nodes: EventNode[], span: SentinelSpan | undefined) => {
    for (const n of nodes) {
      // Flat lists repeat descendants alongside their ancestors.
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      span?.members.push(n);
      if (n.event.event === "tool" && !toolNodeIdsByCallId.has(n.event.id)) {
        toolNodeIdsByCallId.set(n.event.id, n.id);
      } else if (n.event.event === "sentinel") {
        const key = `${n.event.stage}\u0000${n.event.step_id}`;
        const step = steps.get(key) ?? [];
        step.push(eventNodeOf(n, "sentinel"));
        steps.set(key, step);
        if (span) span.stepKey ??= key;
      } else if (span && n.event.event === "model") {
        span.modelCalls.push(eventNodeOf(n, "model"));
      }
      let inner = span;
      if (isSentinelSpan(n)) {
        inner = { node: n, members: [], modelCalls: [] };
        spans.push(inner);
      }
      if (n.children.length) walk(n.children, inner);
    }
  };
  walk(eventNodes, undefined);

  // A span with no sentinel event (e.g. a monitor raised before reporting)
  // keeps its rows, since no step renders its contents.
  const spansByStep = new Map<string, SentinelSpan>();
  for (const span of spans) {
    if (span.stepKey !== undefined && !spansByStep.has(span.stepKey)) {
      spansByStep.set(span.stepKey, span);
    }
  }

  const toolSentinels = new Map<string, ToolSentinels>();
  const standaloneSentinels = new Map<string, SentinelStep>();
  const hiddenSentinelIds = new Set<string>();
  const sentinelScrollRedirects = new Map<string, string>();

  for (const [key, nodes] of steps) {
    const span = spansByStep.get(key);
    const step = buildSentinelStep(nodes, span?.modelCalls);
    const toolNodeId = kToolStages.has(step.stage)
      ? toolNodeIdsByCallId.get(step.stepId)
      : undefined;
    const hostId = toolNodeId ?? span?.node.id ?? nodes[0]!.id;
    if (toolNodeId) {
      const paired = toolSentinels.get(step.stepId) ?? {};
      if (step.stage === "tool_call") paired.before = step;
      else paired.after = step;
      toolSentinels.set(step.stepId, paired);
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
  event.path || event.name;

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

/** The highest score of a suspicion, which stands for it where space is short. */
export const topScore = (
  suspicion: NonNullable<SentinelEvent["suspicion"]>
): TopScore => {
  if (typeof suspicion === "number") {
    return { value: formatScore(suspicion), more: 0 };
  }
  const [dimension, value] = sortedScores(suspicion)[0]!;
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
