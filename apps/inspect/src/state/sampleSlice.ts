import { EventSelectionState, SampleHandle, SampleState } from "../app/types";

import { StoreState } from "./store";

export interface SampleSlice {
  sample: SampleState;
  sampleActions: {
    clearSelectedSample: () => void;

    setCollapsedEvents: (
      scope: string,
      collapsed: Record<string, boolean>
    ) => void;
    collapseEvent: (scope: string, id: string, collapsed: boolean) => void;
    clearCollapsedEvents: () => void;

    setCollapsedIds: (key: string, collapsed: Record<string, true>) => void;
    collapseId: (key: string, id: string, collapsed: boolean) => void;
    clearCollapsedIds: (key: string) => void;
    setCollapsedMode: (mode: "collapsed" | "expanded" | null) => void;

    setFilteredEventTypes: (types: string[] | null) => void;

    setVisiblePopover: (id: string) => void;
    clearVisiblePopover: () => void;

    setSelectedOutlineId: (id: string) => void;
    clearSelectedOutlineId: () => void;

    /** Turn the mode on/off for the sample tab `key`; a different key starts
     *  from an empty selection. */
    setEventSelectionActive: (key: string, active: boolean) => void;
    setEventSelection: (
      key: string,
      selectedIds: string[],
      lastToggledId: string | null
    ) => void;
    /** Drop the selected events; the mode toggle is left as is. */
    clearEventSelection: () => void;
    resetEventSelection: () => void;

    setTimelineSelected: (selected: string | null) => void;
    setActiveTimelineIndex: (index: number) => void;
  };
}

const kNoEventSelection: EventSelectionState = {
  key: null,
  active: false,
  selectedIds: [],
  lastToggledId: null,
};

/** Key of the evidence selection for a sample tab. */
export const eventSelectionKey = (
  handle: SampleHandle | undefined,
  tabId: string
): string =>
  `${handle?.logFile ?? ""}:${handle?.id ?? ""}:${handle?.epoch ?? ""}:${tabId}`;

const initialState: SampleState = {
  visiblePopover: undefined,

  collapsedEvents: null,
  collapsedMode: null,
  eventFilter: {
    // null = the Default preset, resolved dynamically from the sample's
    // events (see dynamicDefaultExcludeEvents)
    filteredTypes: null,
  },

  collapsedIdBuckets: {},
  selectedOutlineId: undefined,

  eventSelection: kNoEventSelection,

  timelineSelected: null,
  activeTimelineIndex: 0,
};

export const createSampleSlice = (
  set: (fn: (state: StoreState) => void) => void,
  _get: () => StoreState,
  _store: unknown
): SampleSlice => {
  const slice = {
    // Actions
    sample: initialState,
    sampleActions: {
      clearSelectedSample: () => {
        set((state) => {
          state.sample.timelineSelected = null;
          state.sample.activeTimelineIndex = 0;
          state.log.selectedSampleHandle = undefined;

          // Clear persisted scroll positions
          delete state.app.propertyBags["scrollPosition"];
        });
      },
      setCollapsedEvents: (
        scope: string,
        collapsed: Record<string, boolean>
      ) => {
        set((state) => {
          if (state.sample.collapsedEvents === null) {
            state.sample.collapsedEvents = {};
          }
          state.sample.collapsedEvents[scope] = collapsed;
        });
      },
      clearCollapsedEvents: () => {
        set((state) => {
          if (state.sample.collapsedEvents !== null) {
            state.sample.collapsedEvents = null;
          }
          state.sample.collapsedMode = null;
        });
      },
      collapseEvent: (scope: string, id: string, collapsed: boolean) => {
        set((state) => {
          if (state.sample.collapsedEvents === null) {
            state.sample.collapsedEvents = {};
          }
          if (!state.sample.collapsedEvents[scope]) {
            state.sample.collapsedEvents[scope] = {};
          }

          if (collapsed) {
            state.sample.collapsedEvents[scope][id] = true;
          } else {
            delete state.sample.collapsedEvents[scope][id];
          }
        });
      },
      setCollapsedIds: (key: string, collapsed: Record<string, true>) => {
        set((state) => {
          state.sample.collapsedIdBuckets[key] = collapsed;
        });
      },
      collapseId: (key: string, id: string, collapsed: boolean) => {
        set((state) => {
          if (state.sample.collapsedIdBuckets[key] === undefined) {
            state.sample.collapsedIdBuckets[key] = {};
          }
          if (collapsed) {
            state.sample.collapsedIdBuckets[key][id] = true;
          } else {
            delete state.sample.collapsedIdBuckets[key][id];
          }
        });
      },
      clearCollapsedIds: (key: string) => {
        set((state) => {
          delete state.sample.collapsedIdBuckets[key];
        });
      },
      setCollapsedMode: (mode: "collapsed" | "expanded" | null) => {
        set((state) => {
          state.sample.collapsedMode = mode;
        });
      },
      setFilteredEventTypes: (types: string[] | null) => {
        set((state) => {
          state.sample.eventFilter.filteredTypes = types;
        });
      },
      setVisiblePopover: (id: string) => {
        set((state) => {
          state.sample.visiblePopover = id;
        });
      },
      clearVisiblePopover: () => {
        set((state) => {
          state.sample.visiblePopover = undefined;
        });
      },
      setSelectedOutlineId: (id: string) => {
        set((state) => {
          state.sample.selectedOutlineId = id;
        });
      },
      clearSelectedOutlineId: () => {
        set((state) => {
          state.sample.selectedOutlineId = undefined;
        });
      },
      setEventSelectionActive: (key: string, active: boolean) => {
        set((state) => {
          if (state.sample.eventSelection.key !== key) {
            state.sample.eventSelection = { ...kNoEventSelection, key };
          }
          state.sample.eventSelection.active = active;
        });
      },
      setEventSelection: (
        key: string,
        selectedIds: string[],
        lastToggledId: string | null
      ) => {
        set((state) => {
          state.sample.eventSelection = {
            key,
            active: true,
            selectedIds,
            lastToggledId,
          };
        });
      },
      clearEventSelection: () => {
        set((state) => {
          state.sample.eventSelection.selectedIds = [];
          state.sample.eventSelection.lastToggledId = null;
        });
      },
      resetEventSelection: () => {
        set((state) => {
          state.sample.eventSelection = kNoEventSelection;
        });
      },
      setTimelineSelected: (selected: string | null) => {
        set((state) => {
          state.sample.timelineSelected = selected;
        });
      },
      setActiveTimelineIndex: (index: number) => {
        set((state) => {
          state.sample.activeTimelineIndex = index;
        });
      },
    },
  } as const;

  return slice;
};

export const initializeSampleSlice = (
  set: (fn: (state: StoreState) => void) => void
) => {
  set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!state.sample) {
      state.sample = initialState;
    }
  });
};
