import { resolveSelected } from "../../selection/rowSelection";
import { useRowSelection } from "../../selection/useRowSelection";
import type { EventType } from "../types";

import { buildSelectableEventIndex } from "./transcriptSelection";

/** `useRowSelection` over a transcript's events. */
export const useTranscriptSelection = (
  resetKey: string,
  events: readonly EventType[],
  running = false
) =>
  useRowSelection(resetKey, (selectedIds) =>
    resolveSelected(buildSelectableEventIndex(events, running), selectedIds)
  );
