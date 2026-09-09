import { buildEventNodes } from "../hooks/useEventNodes";
import { TranscriptIcons } from "../icons";
import { flatTree } from "../transform/flatten";
import { eventFallbackIds } from "../transform/treeify";
import { isStructuralEvent } from "../transform/utils";
import { eventTypeValues, type EventNode, type EventType } from "../types";

const kClearIcon = TranscriptIcons.selection.clear;

/**
 * Evidence selection for transcript export: the event rows a reviewer has
 * checked plus the anchor for shift-click ranges. Hosts own the state (store
 * or component state); the transcript components only read it and hand back
 * the next state through `onChange`.
 */
export interface TranscriptSelectionState {
  /** Selected EventNode ids: the event uuid, or the position-based fallback
   *  for logs that predate uuids (see `eventFallbackIds`). */
  selectedIds: ReadonlySet<string>;
  /** Last individually toggled id; shift-click extends from here. */
  lastToggledId: string | null;
}

/** Host adapter handed to `TranscriptLayout`; present only while selection mode is on. */
export interface TranscriptSelection extends TranscriptSelectionState {
  onChange: (state: TranscriptSelectionState) => void;
}

/** Per-list selection the virtual list hands to event rows via context. */
export interface TranscriptRowSelectionProps {
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string, extend: boolean) => void;
}

// Known, non-structural events only: spans/steps group rows and unknown types
// render nothing, so neither may take a checkbox or enter a range. Selection is
// per row — a checked tool/subtask exports that event alone, not its children.
export const isSelectableEvent = (event: EventType): boolean =>
  (eventTypeValues as readonly string[]).includes(event.event) &&
  !isStructuralEvent(event);

export const kEmptyTranscriptSelection: TranscriptSelectionState = {
  selectedIds: new Set<string>(),
  lastToggledId: null,
};

/**
 * Toggle `id`. With `extend` (shift-click) every id between the anchor and
 * `id` in `visibleIds` takes the clicked row's new state, so a range can be
 * selected or cleared in one gesture; without a usable anchor only `id` flips.
 */
export const toggleTranscriptSelection = (
  state: TranscriptSelectionState,
  visibleIds: readonly string[],
  id: string,
  extend: boolean
): TranscriptSelectionState => {
  const next = new Set(state.selectedIds);
  const select = !next.has(id);
  const anchorIndex =
    extend && state.lastToggledId !== null
      ? visibleIds.indexOf(state.lastToggledId)
      : -1;
  const targetIndex = visibleIds.indexOf(id);
  const ids =
    anchorIndex !== -1 && targetIndex !== -1
      ? visibleIds.slice(
          Math.min(anchorIndex, targetIndex),
          Math.max(anchorIndex, targetIndex) + 1
        )
      : [id];
  for (const rangeId of ids) {
    if (select) {
      next.add(rangeId);
    } else {
      next.delete(rangeId);
    }
  }
  return { selectedIds: next, lastToggledId: id };
};

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

/** The selected events, in transcript order. */
export const resolveSelectedEvents = (
  index: ReadonlyMap<string, EventType>,
  selectedIds: ReadonlySet<string>
): EventType[] => {
  if (selectedIds.size === 0) return [];
  const events: EventType[] = [];
  for (const [id, event] of index) {
    if (selectedIds.has(id)) events.push(event);
  }
  return events;
};

/** The selected ids that resolve, in transcript order (e.g. for a print URL). */
export const resolveSelectedIds = (
  index: ReadonlyMap<string, EventType>,
  selectedIds: ReadonlySet<string>
): string[] => [...index.keys()].filter((id) => selectedIds.has(id));

/** Heading and footer for a Copy/Download menu acting on a selection. */
export const selectionMenuChrome = (count: number, onClear: () => void) => ({
  heading: `Selected events (${count})`,
  footer: { label: "Clear selection", icon: kClearIcon, onClick: onClear },
});
