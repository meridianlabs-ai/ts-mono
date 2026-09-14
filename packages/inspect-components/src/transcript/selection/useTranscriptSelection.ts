import { useState } from "react";

import type { EventType } from "../types";

import {
  buildSelectableEventIndex,
  kEmptyTranscriptSelection,
  resolveSelectedEvents,
  type TranscriptSelection,
  type TranscriptSelectionState,
} from "./transcriptSelection";

/**
 * Component-state backed evidence selection for hosts without a store slice
 * for it. Mode and selection are keyed by `resetKey` and read as off/empty as
 * soon as it changes; pass a per-visit key (`useVisitId` of transcript id plus
 * tab) so switching transcript or tab — and coming back — starts unlatched. Events resolve
 * on demand (`resolveSelected`) so no tree is built during render.
 */
export const useTranscriptSelection = (
  resetKey: string,
  events: readonly EventType[],
  running = false
) => {
  const [stored, setStored] = useState<{
    key: string;
    active: boolean;
    state: TranscriptSelectionState;
  } | null>(null);
  const current =
    stored?.key === resetKey
      ? stored
      : { key: resetKey, active: false, state: kEmptyTranscriptSelection };
  const { active, state } = current;
  const setActive = (value: boolean) =>
    setStored({ ...current, active: value });

  const onChange = (next: TranscriptSelectionState) =>
    setStored({ ...current, state: next });
  const clear = () =>
    setStored({ ...current, state: kEmptyTranscriptSelection });
  const clearAndExit = () => setStored(null);
  const toggleActive = () => setActive(!active);
  const selection: TranscriptSelection | undefined = active
    ? { ...state, onChange }
    : undefined;
  const selectedCount = active ? state.selectedIds.size : 0;
  const resolveSelected = (): EventType[] =>
    selectedCount === 0
      ? []
      : resolveSelectedEvents(
          buildSelectableEventIndex(events, running),
          state.selectedIds
        );

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
