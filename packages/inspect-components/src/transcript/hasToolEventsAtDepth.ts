import { EventNode } from "./types";

/**
 * For each event node, compute whether a backward scan from that node reaches a
 * tool event before it reaches any node strictly shallower than itself. This
 * reproduces, in O(n), the exact result of the former per-index O(n^2) backward
 * scan (`hasToolEventsAtCurrentDepth`) so callers see no behavior change.
 *
 * Semantics (matching the old scan exactly): scanning backward from index i,
 * return true on the first tool event encountered; otherwise return false on
 * the first non-tool node shallower than i's depth. The tool check precedes the
 * depth check, so a node that is both a tool and shallower still returns true.
 *
 * O(n) reformulation. The backward scan from i stops at the first index that is
 * either a tool OR strictly shallower than depth[i]; the result is true iff
 * that first stop is a tool. Equivalently: let `lastToolIndex` be the most
 * recent tool at or before i, and `prevShallower` be the nearest preceding
 * index strictly shallower than depth[i]. The scan hits the tool before any
 * strictly-shallower node iff `lastToolIndex >= prevShallower` (and a tool
 * exists at all). We compute `prevShallower` for every i in amortized O(1)
 * using a monotonic stack whose depths strictly increase from the bottom (a
 * classic "previous strictly-smaller element" stack); each node is pushed and
 * popped at most once, so the whole pass is O(n).
 */
export function computeHasToolEventsAtDepth(
  eventNodes: EventNode[]
): boolean[] {
  const result = new Array<boolean>(eventNodes.length);
  // Monotonic stack of {index, depth} with strictly-increasing depth from the
  // bottom; after popping, the top is the nearest preceding node strictly
  // shallower than the current node.
  const shallowerStack: { index: number; depth: number }[] = [];
  let lastToolIndex = -1;

  for (let i = 0; i < eventNodes.length; i++) {
    const node = eventNodes[i];
    if (!node) {
      result[i] = false;
      continue;
    }
    const depth = node.depth;

    // Pop every entry at this depth or deeper; whatever remains is the nearest
    // preceding node strictly shallower than `depth`.
    while (
      shallowerStack.length > 0 &&
      shallowerStack[shallowerStack.length - 1]!.depth >= depth
    ) {
      shallowerStack.pop();
    }
    const prevShallower =
      shallowerStack.length > 0
        ? shallowerStack[shallowerStack.length - 1]!.index
        : -1;
    shallowerStack.push({ index: i, depth });

    if (node.event.event === "tool") {
      lastToolIndex = i;
    }

    // True iff a tool exists at/before i and the most recent tool is no earlier
    // than the most recent strictly-shallower node (so the backward scan reaches
    // the tool before being stopped by a shallower node).
    result[i] = lastToolIndex >= 0 && lastToolIndex >= prevShallower;
  }

  return result;
}

const noToolEvents: ReadonlySet<string> = new Set();

/**
 * For each event node, the ids of the tool events at its level: its siblings
 * under the same parent. Native tool calls all have a tool event beside the
 * model event that proposed them, but a bridged agent's own tool calls have
 * none (only the host tools the bridge runs for it do), so whether a call or
 * its result message is shown by a tool event is decided per call id.
 *
 * A node's parent is the nearest preceding node strictly shallower than it,
 * found with the same monotonic stack as `computeHasToolEventsAtDepth`.
 */
export function computeToolEventIdsAtLevel(
  eventNodes: EventNode[]
): ReadonlySet<string>[] {
  const levelKeys = new Array<string>(eventNodes.length);
  const idsByLevel = new Map<string, Set<string>>();
  const shallowerStack: { index: number; depth: number }[] = [];

  for (let i = 0; i < eventNodes.length; i++) {
    const node = eventNodes[i];
    if (!node) continue;
    const depth = node.depth;
    while (
      shallowerStack.length > 0 &&
      shallowerStack[shallowerStack.length - 1]!.depth >= depth
    ) {
      shallowerStack.pop();
    }
    const parent =
      shallowerStack.length > 0
        ? shallowerStack[shallowerStack.length - 1]!.index
        : -1;
    shallowerStack.push({ index: i, depth });

    const levelKey = `${parent}:${depth}`;
    levelKeys[i] = levelKey;
    if (node.event.event === "tool") {
      let ids = idsByLevel.get(levelKey);
      if (!ids) {
        ids = new Set();
        idsByLevel.set(levelKey, ids);
      }
      ids.add(node.event.id);
    }
  }

  return eventNodes.map((_node, i) => {
    const levelKey = levelKeys[i];
    return (levelKey && idsByLevel.get(levelKey)) || noToolEvents;
  });
}
