import {
  computeTurnMap,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
  type TurnInfo,
} from "./outline/tree-visitors";
import { kSandboxSignalName } from "./transform/fixups";
import { flatTree } from "./transform/flatten";
import type { EventNode } from "./types";

export const kTranscriptScrollPaddingStart = -50;

// Structural / non-turn-content event types the transcript hides by default.
// Excluding them from the focused-turn slice keeps the model event adjacent to
// its tool events (so it renders its compact summary, not inline tool calls)
// and drops sandbox/state noise.
const kFocusExcludedEvents = new Set([
  "sample_init",
  "sandbox",
  "state",
  "store",
  "branch",
  "anchor",
  "checkpoint",
  "span_begin",
  "span_end",
]);

/**
 * Compute the turn map + ordered turn-anchor ids for a transcript. Shared by
 * the transcript list and the single-event page's turn navigation.
 *
 * Every model call is a turn (including model-graded scorer calls) — only the
 * structural/noise event types are dropped (logger/info/state/etc.), matching
 * what the transcript counts. Crucially, scorer-span children are NOT stripped
 * here: the main transcript builds its tree from timeline-processed events where
 * scorer spans aren't recognized as such, so it counts scorers as turns; the
 * single-event page builds from raw events, so it must not strip them either or
 * its "turn N/M" total would disagree with the transcript.
 *
 * Pass the default collapse state (not the user's live transcript collapse) so
 * user-collapsing a region doesn't renumber the turns below it. The visible
 * `flattenedNodes` still decides which turns are navigable anchors (you can't
 * jump to a turn hidden inside a collapsed region).
 */
export function computeTranscriptTurns(
  eventNodes: EventNode[],
  flattenedNodes: EventNode[],
  collapsed: Record<string, boolean> | null
): { turnMap: Map<string, TurnInfo>; anchorIds: string[] } {
  const outlineFiltered = flatTree(eventNodes, collapsed, [
    removeNodeVisitor("logger"),
    removeNodeVisitor("info"),
    removeNodeVisitor("state"),
    removeNodeVisitor("store"),
    removeNodeVisitor("approval"),
    removeNodeVisitor("input"),
    removeNodeVisitor("sandbox"),
    removeStepSpanNameVisitor(kSandboxSignalName),
  ]);
  const turnMap = computeTurnMap(outlineFiltered, flattenedNodes);
  return { turnMap, anchorIds: computeTurnAnchorIds(flattenedNodes, turnMap) };
}

/**
 * Ordered ids of the events that open each visible turn — the model event
 * where the turn number first increments. These are the targets for j/k
 * keyboard navigation and the header turn chevrons.
 *
 * Derived from the same turn map that drives the header "turn N/M" labels, so
 * navigation lands on real turns regardless of nesting depth, and naturally
 * skips turns whose opening event is hidden inside a collapsed region (their
 * turn number never appears in the flattened list).
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

/**
 * Build the event nodes for the standalone single-event page: take the turn
 * slice for `eventId`, then drop structural/noise events (so the focused model
 * sits next to its tool events the way the full transcript shows them). Render
 * the result with `hasToolEvents: true` so the model shows its compact summary
 * rather than expanding its input tool messages (the per-node back-scan can't
 * see prior turns in a slice).
 *
 * Slicing happens on the *unfiltered* flat list so the span boundaries are
 * still present: `turnSlice` stops a turn at the next shallower node, and a
 * span_begin (e.g. the `scorers` span after a scorer model) is exactly that
 * boundary. Filtering spans out first would hide it, and the slice would run on
 * into the following (more deeply nested) scorer turns.
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
 * Flat-list slice for a focused single event, taken from the same flat list the
 * transcript renders (so tool calls, sandbox spans, etc. render exactly as they
 * do inline — not re-grouped).
 *
 * For a model event the slice is the whole turn: from the model up to the next
 * model at the same-or-shallower depth (tool calls and their sandbox spans sit
 * between two models at the turn depth, so a turn isn't a contiguous run of
 * same-typed siblings). For any other event it's just that event and its
 * descendants.
 *
 * @param flat - The fully-flattened event list (`flatTree(nodes, null)`).
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
