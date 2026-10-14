import type { StoreSlice } from "./store";

// Session memory for list selection and directory choices outside their routes.
export interface RoutingSlice {
  selectedScanLocation?: string;
  userTranscriptsDir?: string;
  userScansDir?: string;

  setSelectedScanLocation: (location: string) => void;
  setUserScansDir: (path: string) => void;
  setUserTranscriptsDir: (path: string) => void;
}

export const createRoutingSlice: StoreSlice<RoutingSlice> = (set) => ({
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
