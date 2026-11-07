import { useState } from "react";

import {
  kEmptyRowSelection,
  type RowSelection,
  type RowSelectionState,
} from "./rowSelection";

/**
 * Component-state backed evidence selection for hosts without a store slice
 * for it. Mode and selection are keyed by `resetKey` and read as off/empty as
 * soon as it changes; pass a per-visit key (`useVisitId` of transcript id plus
 * tab) so switching transcript or tab — and coming back — starts unlatched.
 * `resolve` maps the selected ids to the rows' data; it runs on demand
 * (`resolveSelected`), never during render.
 */
export const useRowSelection = <T>(
  resetKey: string,
  resolve: (selectedIds: ReadonlySet<string>) => T[]
) => {
  const [stored, setStored] = useState<{
    key: string;
    active: boolean;
    state: RowSelectionState;
  } | null>(null);
  const current =
    stored?.key === resetKey
      ? stored
      : { key: resetKey, active: false, state: kEmptyRowSelection };
  const { active, state } = current;
  const setActive = (value: boolean) =>
    setStored({ ...current, active: value });

  const onChange = (next: RowSelectionState) =>
    setStored({ ...current, state: next });
  const clear = () => setStored({ ...current, state: kEmptyRowSelection });
  const clearAndExit = () => setStored(null);
  const toggleActive = () => setActive(!active);
  const selection: RowSelection | undefined = active
    ? { ...state, onChange }
    : undefined;
  const selectedCount = active ? state.selectedIds.size : 0;
  const resolveSelected = (): T[] =>
    selectedCount === 0 ? [] : resolve(state.selectedIds);

  return {
    active,
    toggleActive,
    selection,
    selectedCount,
    resolveSelected,
    clear,
    clearAndExit,
  };
};
