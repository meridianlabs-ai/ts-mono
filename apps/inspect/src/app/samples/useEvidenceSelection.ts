import type { ChatMessage } from "@tsmono/inspect-common/types";
import {
  buildSelectableMessageIndex,
  messagesToMarkdown,
  messagesToStr,
} from "@tsmono/inspect-components/chat";
import {
  resolveSelected,
  resolveSelectedIds,
  selectionMenuChrome,
  type RowSelection,
  type SelectableItem,
} from "@tsmono/inspect-components/selection";
import {
  buildSelectableEventIndex,
  eventsToMarkdown,
  eventsToStr,
} from "@tsmono/inspect-components/transcript";
import { useVisitId } from "@tsmono/react/hooks";

import { Events } from "../../@types/extraInspect";
import { kSampleMessagesTabId, kSampleTranscriptTabId } from "../../constants";
import { evidenceSelectionKey } from "../../state/sampleSlice";
import { useStore } from "../../state/store";
import type { SampleHandle } from "../types";

export type EvidenceFormat = "markdown" | "text" | "json";

interface EvidenceSelectionOptions {
  handle: SampleHandle | undefined;
  tab: string | undefined;
  /** The tab's list has rows to select (chunked samples never do: they
   *  window their events and messages, so there is no full list to export). */
  selectable: boolean;
  events: Events;
  running: boolean;
  /** The whole conversation; read only when a message export runs. */
  messages: () => ChatMessage[];
}

/** Resolved selection for one export: the rows' ids and their documents. */
interface ResolvedEvidence {
  ids: string[];
  render: (format: EvidenceFormat) => string;
}

/**
 * Evidence selection on the sample's Transcript (events) and Messages tabs.
 * The store holds one selection, keyed by visit of one sample tab, so each
 * tab starts unlatched and leaving it drops what was selected. Ids resolve to
 * events or messages only at export/print time, never per render.
 */
export const useEvidenceSelection = ({
  handle,
  tab,
  selectable,
  events,
  running,
  messages,
}: EvidenceSelectionOptions) => {
  const item: SelectableItem | undefined =
    tab === kSampleTranscriptTabId
      ? "event"
      : tab === kSampleMessagesTabId
        ? "message"
        : undefined;
  const key = useVisitId(evidenceSelectionKey(handle, tab ?? ""));
  const stored = useStore((state) => state.sample.evidenceSelection);
  const setActive = useStore(
    (state) => state.sampleActions.setEvidenceSelectionActive
  );
  const setSelection = useStore(
    (state) => state.sampleActions.setEvidenceSelection
  );
  const clear = useStore((state) => state.sampleActions.clearEvidenceSelection);
  const reset = useStore((state) => state.sampleActions.resetEvidenceSelection);

  const current = item !== undefined && stored.key === key ? stored : undefined;
  const active = current?.active ?? false;
  const listSelection: RowSelection | undefined = current?.active
    ? {
        selectedIds: new Set(current.selectedIds),
        lastToggledId: current.lastToggledId,
        onChange: (next) =>
          setSelection(key, [...next.selectedIds], next.lastToggledId),
      }
    : undefined;
  const selectedIds = listSelection?.selectedIds;
  const count = selectedIds?.size ?? 0;

  const resolve = (ids: ReadonlySet<string>): ResolvedEvidence | undefined => {
    if (item === "event") {
      const index = buildSelectableEventIndex(events, running);
      const selected = resolveSelected(index, ids);
      if (selected.length === 0) return undefined;
      return {
        ids: resolveSelectedIds(index, ids),
        render: (format) =>
          format === "markdown"
            ? eventsToMarkdown(selected)
            : format === "text"
              ? eventsToStr(selected)
              : JSON.stringify(selected, null, 2),
      };
    }
    if (item === "message") {
      const index = buildSelectableMessageIndex(messages());
      const selected = resolveSelected(index, ids).flat();
      if (selected.length === 0) return undefined;
      return {
        ids: resolveSelectedIds(index, ids),
        render: (format) =>
          format === "markdown"
            ? messagesToMarkdown(selected)
            : format === "text"
              ? messagesToStr(selected)
              : JSON.stringify(selected, null, 2),
      };
    }
    return undefined;
  };

  return {
    /** Toolbar Select tool props; absent on tabs without a selectable list. */
    tool:
      item !== undefined && selectable
        ? {
            item,
            active,
            count,
            onToggle: () => setActive(key, !active),
            onClear: reset,
          }
        : undefined,
    /** The active tab's list selection, present while the mode is on. */
    listSelection,
    /** Present while rows are selected; Copy/Download/Print act on these. */
    selected:
      item !== undefined && selectedIds !== undefined && count > 0
        ? {
            item,
            count,
            menu: selectionMenuChrome(count, item, clear),
            /** The selection as a document, or undefined (with a warning)
             *  when none of its ids are in this sample any more. */
            render: (format: EvidenceFormat): string | undefined => {
              const evidence = resolve(selectedIds);
              if (!evidence) {
                console.warn(`Selected ${item}s are no longer in this sample.`);
              }
              return evidence?.render(format);
            },
            /** Ids for the print route. When none resolve, the stored ids go
             *  through so the print view reports them missing rather than
             *  printing the whole sample. */
            printIds: (): string[] => {
              const ids = resolve(selectedIds)?.ids ?? [];
              return ids.length > 0 ? ids : [...selectedIds];
            },
          }
        : undefined,
  };
};
