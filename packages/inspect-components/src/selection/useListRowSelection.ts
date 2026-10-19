import { useLatestRef } from "@tsmono/react/hooks";

import {
  toggleRowSelection,
  type ListRowSelection,
  type RowSelection,
} from "./rowSelection";

/**
 * The per-list selection a list hands its rows: the host's selected ids and a
 * toggle that applies click / shift-click ranges over `visibleIds()`, the rows
 * as the user currently sees them. The toggle reads live state through a ref,
 * so the compiler keeps its identity — which feeds every row's context —
 * stable.
 */
export const useListRowSelection = (
  selection: RowSelection | undefined,
  visibleIds: () => readonly string[]
): ListRowSelection | undefined => {
  const latest = useLatestRef({ selection, visibleIds });
  const onToggle = (id: string, extend: boolean) => {
    const { selection: current, visibleIds: currentVisibleIds } =
      latest.current;
    if (!current) return;
    current.onChange(
      toggleRowSelection(current, currentVisibleIds(), id, extend)
    );
  };
  return selection
    ? { selectedIds: selection.selectedIds, onToggle }
    : undefined;
};
