import type { StoreSlice } from "./store";

// Navigation restoration: which locations the user has selected and whether
// the router has consumed them yet. hasInitializedRouting is deliberately not
// persisted (see partialize in store.ts).
export interface RoutingSlice {
  hasInitializedRouting?: boolean;
  selectedScanLocation?: string;
  userTranscriptsDir?: string;
  userScansDir?: string;

  setHasInitializedRouting: (initialized: boolean) => void;
  setSelectedScanLocation: (location: string) => void;
  setUserScansDir: (path: string) => void;
  setUserTranscriptsDir: (path: string) => void;
}

export const createRoutingSlice: StoreSlice<RoutingSlice> = (set) => ({
  setHasInitializedRouting: (initialized: boolean) => {
    set((state) => {
      state.hasInitializedRouting = initialized;
    });
  },
  setSelectedScanLocation: (location: string) =>
    set((state) => {
      state.selectedScanLocation = location;
    }),
  setUserScansDir: (path: string) => {
    set((state) => {
      state.userScansDir = path;
    });
  },
  setUserTranscriptsDir: (path: string) => {
    set((state) => {
      state.userTranscriptsDir = path;
    });
  },
});
