import {
  computeTurnMap,
  outlineFilterVisitors,
  type TurnInfo,
} from "./outline/tree-visitors";
import { flatTree } from "./transform/flatten";
import { kDefaultExcludeEvents, type EventNode } from "./types";

export const kTranscriptScrollPaddingStart = -50;

// The events the transcript hides by default, plus the span markers - dropped
// from the focus slice so the focused model renders next to its tool events
// (compact summary, not inline tool calls).
const kFocusExcludedEvents = new Set([
  ...kDefaultExcludeEvents,
  "span_begin",
  "span_end",
]);

/**
 * Turn map + ordered turn-anchor ids for a transcript. Shared by the transcript
 * list and the single-event page.
 *
 * Uses the same `outlineFilterVisitors()` as the outline so turn counts match,
 * but does NOT strip scorer-span children: the transcript builds from
 * timeline-processed events that don't recognize scorer spans, so it counts
 * scorer calls as turns, and the raw-events single-event page must match or its
 * "turn N/M" total disagrees.
 *
 * Pass the *default* collapse state, not the user's live collapse, so collapsing
 * a region doesn't renumber turns below it. `flattenedNodes` still gates which
 * turns are navigable (none hidden in a collapsed region).
 */
export function computeTranscriptTurns(
  eventNodes: EventNode[],
  flattenedNodes: EventNode[],
  collapsed: Record<string, boolean> | null
): { turnMap: Map<string, TurnInfo>; anchorIds: string[] } {
  const outlineFiltered = flatTree(
    eventNodes,
    collapsed,
    outlineFilterVisitors()
  );
  const turnMap = computeTurnMap(outlineFiltered, flattenedNodes);
  return { turnMap, anchorIds: computeTurnAnchorIds(flattenedNodes, turnMap) };
}

/**
 * Ordered ids of the model events that open each visible turn (where the turn
 * number first increments) - the targets for j/k and the header chevrons. Built
 * from the same turn map as the "turn N/M" label, so it skips turns whose
 * opening event is hidden in a collapsed region.
 */
export function computeTurnAnchorIds(
  flattenedNodes: EventNode[],
  turnMap: Map<string, TurnInfo>
): string[] {
  const ids: string[] = [];
  let last = 0;
  for (const node of flattenedNodes) {
    const turn = turnMap.get(node.id)?.turnNumber;
    if (turn !== undefined && turn > last) {
      ids.push(node.id);
      last = turn;
    }
  }
  return ids;
}

/** One agent lane (main or a subagent) with its ordered turn anchors. */
export interface AgentLane {
  /** "main" for the top-level agent, else the subagent span's name. */
  name: string;
  /** Ordered turn-anchor (model event) ids within this lane. */
  turnAnchorIds: string[];
}

/**
 * Group turns into agent lanes - "main" plus each nested subagent - for the focus
 * page's per-subagent turn count and h/l / `<` `>` agent navigation. A turn
 * belongs to the innermost enclosing `span_begin type="agent"`, tracked by a
 * depth stack so arbitrarily deep nesting works (deeper agents are just later
 * lanes). Lanes with no turns are dropped, so "main" disappears when every turn
 * lives in a subagent.
 */
export function computeAgentLanes(flattenedNodes: EventNode[]): AgentLane[] {
  const main: AgentLane = { name: "main", turnAnchorIds: [] };
  const lanes: AgentLane[] = [main];
  const stack: Array<{ depth: number; lane: AgentLane }> = [];
  for (const node of flattenedNodes) {
    while (stack.length > 0 && node.depth <= stack[stack.length - 1]!.depth) {
      stack.pop();
    }
    const event = node.event;
    if (event.event === "span_begin" && event.type === "agent") {
      const lane: AgentLane = {
        name: event.name ?? "agent",
        turnAnchorIds: [],
      };
      lanes.push(lane);
      stack.push({ depth: node.depth, lane });
    } else if (event.event === "model") {
      const lane = stack.length > 0 ? stack[stack.length - 1]!.lane : main;
      lane.turnAnchorIds.push(node.id);
    }
  }
  return lanes.filter((lane) => lane.turnAnchorIds.length > 0);
}

/**
 * Event nodes for the standalone single-event page: the turn slice for `eventId`
 * minus structural/noise events.
 *
 * Slice on the *unfiltered* flat list so span boundaries survive - `turnSlice`
 * ends a turn at the next shallower node, and a span_begin (e.g. the `scorers`
 * span after a scorer model) is exactly that boundary. Filtering spans out first
 * would drop it and run the slice on into the following scorer turns.
 */
export function focusedTurnNodes(
  eventNodes: EventNode[],
  eventId: string
): EventNode[] {
  const flat = flatTree(eventNodes, null);
  return turnSlice(flat, eventId).filter(
    (n) => !kFocusExcludedEvents.has(n.event.event)
  );
}

/**
 * Flat-list slice for a focused event, from the same flat list the transcript
 * renders (so tool calls, sandbox spans, etc. look identical inline).
 *
 * For a model event the slice is the whole turn: up to the next model at the
 * same-or-shallower depth (tool calls and their sandbox spans sit between two
 * models at the turn depth, so a turn isn't a contiguous run of same-typed
 * siblings). Otherwise just the event and its descendants.
 *
 * @param flat - Fully-flattened list (`flatTree(nodes, null)`).
 * @param eventId - The focused event's node id.
 */
function turnSlice(flat: EventNode[], eventId: string): EventNode[] {
  const start = flat.findIndex((n) => n.id === eventId);
  const target = start === -1 ? undefined : flat[start];
  if (!target) return [];
  const depth = target.depth;
  const isModel = target.event.event === "model";
  let end = start + 1;
  while (end < flat.length) {
    const node = flat[end];
    if (!node) break;
    if (node.depth < depth) break;
    if (isModel) {
      if (node.depth === depth && node.event.event === "model") break;
    } else if (node.depth <= depth) {
      break;
    }
    end++;
  }
  return flat.slice(start, end);
}
