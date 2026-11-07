import type { IconName } from "@tsmono/react/icons";

/** What a list's rows are, for labels and titles ("Select events"). */
export type SelectableItem = "event" | "message";

/**
 * Evidence selection for export: the rows a reviewer has checked plus the
 * anchor for shift-click ranges. Hosts own the state (store or component
 * state); lists only read it and hand back the next state through `onChange`.
 */
export interface RowSelectionState {
  /** Selected row ids, as the list assigns them. */
  selectedIds: ReadonlySet<string>;
  /** Last individually toggled id; shift-click extends from here. */
  lastToggledId: string | null;
}

/** Host adapter handed to a list; present only while selection mode is on. */
export interface RowSelection extends RowSelectionState {
  onChange: (state: RowSelectionState) => void;
}

/** Per-list selection a list hands to its rows via context. */
export interface ListRowSelection {
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string, extend: boolean) => void;
}

export const kEmptyRowSelection: RowSelectionState = {
  selectedIds: new Set<string>(),
  lastToggledId: null,
};

/**
 * Toggle `id`. With `extend` (shift-click) every id between the anchor and
 * `id` in `visibleIds` takes the clicked row's new state, so a range can be
 * selected or cleared in one gesture; without a usable anchor only `id` flips.
 */
export const toggleRowSelection = (
  state: RowSelectionState,
  visibleIds: readonly string[],
  id: string,
  extend: boolean
): RowSelectionState => {
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

/** The values of the selected ids in `index`, in index (list) order. */
export const resolveSelected = <T>(
  index: ReadonlyMap<string, T>,
  selectedIds: ReadonlySet<string>
): T[] => {
  if (selectedIds.size === 0) return [];
  const values: T[] = [];
  for (const [id, value] of index) {
    if (selectedIds.has(id)) values.push(value);
  }
  return values;
};

/** The selected ids that resolve, in index order (e.g. for a print URL). */
export const resolveSelectedIds = (
  index: ReadonlyMap<string, unknown>,
  selectedIds: ReadonlySet<string>
): string[] => [...index.keys()].filter((id) => selectedIds.has(id));

/** Heading and footer for a Copy/Download menu acting on a selection. */
export const selectionMenuChrome = (
  count: number,
  item: SelectableItem,
  onClear: () => void
): {
  heading: string;
  footer: { label: string; icon: IconName; onClick: () => void };
} => ({
  heading: `Selected ${item}s (${count})`,
  footer: {
    label: "Clear selection",
    icon: "selectionClear",
    onClick: onClear,
  },
});
