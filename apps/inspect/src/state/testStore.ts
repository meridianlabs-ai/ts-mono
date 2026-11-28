/**
 * Cast-free StoreState fixture: a real store built from the production slice
 * creators (no persist/devtools), so tests get every slice's actual initial
 * state and can spread in overrides.
 */
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import { createAppSlice } from "./appSlice";
import { createLogSlice } from "./logSlice";
import { createLogsSlice } from "./logsSlice";
import { createSampleSlice } from "./sampleSlice";
import { createSearchSlice } from "./searchSlice";
import type { StoreState } from "./store";

export const createTestStore = () =>
  create<StoreState>()(
    immer((set, get) => ({
      initialize: () => undefined,
      ...createAppSlice(set, get),
      ...createLogsSlice(set, get),
      ...createLogSlice(set, get),
      ...createSampleSlice(set),
      ...createSearchSlice(set),
    }))
  );

export const testStoreState = (): StoreState => createTestStore().getState();
