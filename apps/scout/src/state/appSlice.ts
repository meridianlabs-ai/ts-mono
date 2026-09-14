import { ErrorScope } from "../app/types";

import type { StoreSlice } from "./store";

export interface AppSlice {
  singleFileMode?: boolean;
  hasInitializedEmbeddedData?: boolean;
  scopedErrors: Record<ErrorScope, string | undefined>;
  showFind?: boolean;

  setShowFind: (show: boolean) => void;
  setSingleFileMode: (enabled: boolean) => void;
  setHasInitializedEmbeddedData: (initialized: boolean) => void;
  setError: (scope: ErrorScope, error: string | undefined) => void;
  clearError: (scope: ErrorScope) => void;
}

export const createAppSlice: StoreSlice<AppSlice> = (set) => ({
  scopedErrors: {
    scans: undefined,
    scanner: undefined,
    dataframe: undefined,
    dataframe_input: undefined,
    transcripts: undefined,
  },

  setShowFind(show: boolean) {
    set((state) => {
      state.showFind = show;
    });
  },
  setSingleFileMode: (enabled: boolean) => {
    set((state) => {
      state.singleFileMode = enabled;
    });
  },
  setHasInitializedEmbeddedData: (initialized: boolean) => {
    set((state) => {
      state.hasInitializedEmbeddedData = initialized;
    });
  },
  setError: (scope: ErrorScope, error: string | undefined) => {
    set((state) => {
      state.scopedErrors[scope] = error;
    });
  },
  clearError: (scope: ErrorScope) => {
    set((state) => {
      state.scopedErrors[scope] = undefined;
    });
  },
});
