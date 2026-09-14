import {
  createInitialSearchPanelState,
  normalizeSearchPanelState,
  type SearchPanelState,
} from "@tsmono/inspect-components/transcript-search";

import type { StoreSlice } from "./store";

export interface TranscriptState {
  excludedTypes?: string[];
  collapsed?: boolean;
  outlineCollapsed?: boolean;
  displayMode?: "rendered" | "raw";
  validationSidebarCollapsed?: boolean;
}

// One open transcript: event collapse state, outline, search panels, and the
// detail properties cleared when switching transcripts.
export interface TranscriptSlice {
  transcriptCollapsedEvents: Record<string, Record<string, boolean>>;
  transcriptOutlineId?: string;
  searchPanelStates: Record<string, SearchPanelState | undefined>;

  // Transcript Detail properties (clear when switching transcripts)
  selectedTranscriptTab?: string;

  // Transcript Detail Data
  transcriptState: TranscriptState;

  clearTranscriptState: () => void;

  setTranscriptOutlineId: (id: string) => void;
  clearTranscriptOutlineId: () => void;

  setSelectedTranscriptTab: (tab: string) => void;
  setSearchPanelState: (
    key: string,
    updater: SearchPanelState | ((prev: SearchPanelState) => SearchPanelState)
  ) => void;

  setTranscriptCollapsedEvent: (
    scope: string,
    event: string,
    collapsed: boolean
  ) => void;
  setTranscriptCollapsedEvents: (
    scope: string,
    events: Record<string, boolean>
  ) => void;

  setTranscriptState: (
    updater: TranscriptState | ((prev: TranscriptState) => TranscriptState)
  ) => void;
}

export const createTranscriptSlice: StoreSlice<TranscriptSlice> = (set) => ({
  transcriptCollapsedEvents: {},
  searchPanelStates: {},
  transcriptState: {},

  clearTranscriptState: () => {
    set((state) => {
      state.selectedTranscriptTab = undefined;
      state.searchPanelStates = {};
    });
  },
  setTranscriptOutlineId: (id: string) => {
    set((state) => {
      state.transcriptOutlineId = id;
    });
  },
  clearTranscriptOutlineId: () => {
    set((state) => {
      state.transcriptOutlineId = undefined;
    });
  },
  setSelectedTranscriptTab: (tab: string) => {
    set((state) => {
      state.selectedTranscriptTab = tab;
    });
  },
  setSearchPanelState: (key, updater) => {
    set((state) => {
      const prev = normalizeSearchPanelState(
        state.searchPanelStates[key] ?? createInitialSearchPanelState()
      );
      state.searchPanelStates[key] =
        typeof updater === "function" ? updater(prev) : updater;
    });
  },
  setTranscriptCollapsedEvent: (
    scope: string,
    event: string,
    collapsed: boolean
  ) => {
    set((state) => {
      if (!state.transcriptCollapsedEvents[scope]) {
        state.transcriptCollapsedEvents[scope] = {};
      }
      state.transcriptCollapsedEvents[scope][event] = collapsed;
    });
  },
  setTranscriptCollapsedEvents: (
    scope: string,
    events: Record<string, boolean>
  ) => {
    set((state) => {
      state.transcriptCollapsedEvents[scope] = events;
    });
  },
  setTranscriptState(updater) {
    set((state) => {
      state.transcriptState =
        typeof updater === "function"
          ? updater(state.transcriptState)
          : updater;
    });
  },
});
