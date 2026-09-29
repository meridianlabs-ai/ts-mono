import type { SentinelEvent } from "@tsmono/inspect-common/types";

import { eventNodeOf } from "../types";
import type { EventNode } from "../types";

export type SentinelNode = EventNode<SentinelEvent>;

export interface SentinelRow {
  node: SentinelNode;
  /** Nesting depth of the instance path, relative to the step's shallowest row. */
  depth: number;
  /** Set on the decision that took effect when the step has folded events: `final` when it passed layers that were bypassed. */
  effect?: "final" | "took effect";
  /** The bypassed, superseded and cancelled events of the step, on the decision that took effect. */
  folded: SentinelNode[];
}

/** The sentinel events recorded for one step, as rows in path order. */
export interface SentinelStep {
  stage: SentinelEvent["stage"];
  stepId: string;
  rows: SentinelRow[];
  /** Folded events of a step that has no report to attach them to. */
  folded: SentinelNode[];
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

const isFolded = (event: SentinelEvent): boolean =>
  event.kind === "bypassed" ||
  event.kind === "superseded" ||
  event.kind === "cancelled";

const pathSegments = (path: string): string[] =>
  path === "" ? [] : path.split("/");

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

/**
 * Builds the rows for one step's events, given in recording order. Only
 * observations and decisions get rows; the rest fold onto the decision that
 * took effect, which the runner records last. A decision a later
 * `superseded` event names appears only in the fold.
 */
export function buildSentinelStep(nodes: SentinelNode[]): SentinelStep {
  const first = nodes[0];
  const reports = nodes.filter((n) => !isFolded(n.event));
  const folded = nodes.filter((n) => isFolded(n.event));

  const superseded = new Set<SentinelNode>();
  for (const loser of folded) {
    if (loser.event.kind !== "superseded") continue;
    const at = nodes.indexOf(loser);
    for (const report of reports) {
      if (
        report.event.kind === "decision" &&
        report.event.path === loser.event.path &&
        report.event.function === loser.event.function &&
        nodes.indexOf(report) < at
      ) {
        superseded.add(report);
      }
    }
  }

  const shown = reports.filter((n) => !superseded.has(n));
  const effective =
    shown.findLast((n) => n.event.kind === "decision") ?? shown.at(-1);
  const effect: SentinelRow["effect"] = folded.some(
    (n) => n.event.kind === "bypassed"
  )
    ? "final"
    : "took effect";

  const keys = pathOrderKeys(nodes);
  const depthOf = (node: SentinelNode) => pathSegments(node.event.path).length;
  const minDepth = Math.min(...shown.map(depthOf));
  const rows: SentinelRow[] = shown
    .map((node, index) => ({ node, index }))
    .sort(
      (a, b) =>
        compareKeys(keys.get(a.node)!, keys.get(b.node)!) || a.index - b.index
    )
    .map(({ node }) => ({
      node,
      depth: depthOf(node) - minDepth,
      effect: node === effective && folded.length > 0 ? effect : undefined,
      folded: node === effective ? folded : [],
    }));

  return {
    stage: first?.event.stage ?? "tool_call",
    stepId: first?.event.step_id ?? "",
    rows,
    folded: effective ? [] : folded,
  };
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
  const seen = new Set<string>();
  const walk = (nodes: EventNode[]) => {
    for (const n of nodes) {
      // Flat lists repeat descendants alongside their ancestors.
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (n.event.event === "tool" && !toolNodeIdsByCallId.has(n.event.id)) {
        toolNodeIdsByCallId.set(n.event.id, n.id);
      } else if (n.event.event === "sentinel") {
        const key = `${n.event.stage}\u0000${n.event.step_id}`;
        const step = steps.get(key) ?? [];
        step.push(eventNodeOf(n, "sentinel"));
        steps.set(key, step);
      }
      if (n.children.length) walk(n.children);
    }
  };
  walk(eventNodes);

  const toolSentinels = new Map<string, ToolSentinels>();
  const standaloneSentinels = new Map<string, SentinelStep>();
  const hiddenSentinelIds = new Set<string>();
  const sentinelScrollRedirects = new Map<string, string>();

  for (const nodes of steps.values()) {
    const step = buildSentinelStep(nodes);
    const toolNodeId = kToolStages.has(step.stage)
      ? toolNodeIdsByCallId.get(step.stepId)
      : undefined;
    const hostId = toolNodeId ?? nodes[0]!.id;
    if (toolNodeId) {
      const paired = toolSentinels.get(step.stepId) ?? {};
      if (step.stage === "tool_call") paired.before = step;
      else paired.after = step;
      toolSentinels.set(step.stepId, paired);
    } else {
      standaloneSentinels.set(hostId, step);
    }
    for (const node of nodes) {
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

/** One line naming what the folded events did, e.g. "overrode 2 layers · 1 cancelled". */
export const foldedSummary = (folded: SentinelNode[]): string => {
  const count = (kind: SentinelEvent["kind"]) =>
    folded.filter((n) => n.event.kind === kind).length;
  const bypassed = count("bypassed");
  const superseded = count("superseded");
  const cancelled = count("cancelled");
  return [
    bypassed ? `overrode ${plural(bypassed, "layer")}` : "",
    superseded ? `${plural(superseded, "decision")} superseded` : "",
    cancelled ? `${cancelled} cancelled` : "",
  ]
    .filter(Boolean)
    .join(" · ");
};

const plural = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The instance path, or the factory's registry name at the root. */
export const instanceLabel = (event: SentinelEvent): string =>
  event.path || event.name;

export const formatSuspicion = (
  suspicion: NonNullable<SentinelEvent["suspicion"]>
): string => {
  const format = (value: number) => String(Math.round(value * 100) / 100);
  if (typeof suspicion === "number") return format(suspicion);
  return Object.entries(suspicion)
    .map(([dimension, value]) => `${dimension} ${format(value)}`)
    .join(", ");
};

/** A modify decision's replacement call, with every argument spelled out. */
export const formatModifiedCall = (
  call: NonNullable<SentinelEvent["modified"]>
): string =>
  `${call.function}(${Object.entries(call.arguments)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(", ")})`;
