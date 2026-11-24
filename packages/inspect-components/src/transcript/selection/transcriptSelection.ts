import { buildEventNodes } from "../hooks/useEventNodes";
import { flatTree } from "../transform/flatten";
import { eventFallbackIds } from "../transform/treeify";
import { isStructuralEvent } from "../transform/utils";
import { eventTypeValues, type EventNode, type EventType } from "../types";

// Transcript rows are EventNodes; their ids (the selection's ids) are the
// event uuid, or the position-based fallback for logs that predate uuids (see
// `eventFallbackIds`).

// Known, non-structural events only: spans/steps group rows and unknown types
// render nothing, so neither may take a checkbox or enter a range. Selection is
// per row — a checked tool/subtask exports that event alone, not its children.
export const isSelectableEvent = (event: EventType): boolean =>
  (eventTypeValues as readonly string[]).includes(event.event) &&
  !isStructuralEvent(event);

/** The selected, selectable nodes of `nodes` (a flattened tree), in order. */
export const selectedEventNodes = (
  nodes: readonly EventNode[],
  selectedIds: ReadonlySet<string>
): EventNode[] =>
  selectedIds.size === 0
    ? []
    : nodes.filter((n) => selectedIds.has(n.id) && isSelectableEvent(n.event));

/**
 * Id → event for every selectable event, in transcript order, built from the
 * full (unfiltered) list with the transcript's own pipeline so ids resolve
 * regardless of the filter or lane they were selected under. Values are the
 * original event objects wherever the id maps back to one (uuid or position
 * id); a tree-path id can only yield the pipeline's clone. A full tree build —
 * call it at export time, not per render.
 */
export const buildSelectableEventIndex = (
  events: readonly EventType[],
  running: boolean
): ReadonlyMap<string, EventType> => {
  const fallbackIds = eventFallbackIds(events);
  const originals = new Map<string, EventType>();
  for (const event of events) {
    const id = event.uuid || fallbackIds.get(event);
    if (id) originals.set(id, event);
  }
  const { eventNodes } = buildEventNodes([...events], running);
  const index = new Map<string, EventType>();
  for (const node of flatTree(eventNodes, null)) {
    if (isSelectableEvent(node.event)) {
      index.set(node.id, originals.get(node.id) ?? node.event);
    }
  }
  return index;
};
