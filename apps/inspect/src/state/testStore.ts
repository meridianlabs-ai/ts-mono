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

export const testStoreState = (): StoreState =>
  create<StoreState>()(
    immer((set, get, store) => ({
      initialize: () => undefined,
      ...createAppSlice(set, get, store),
      ...createLogsSlice(set, get, store),
      ...createLogSlice(set, get, store),
      ...createSampleSlice(set, get, store),
      ...createSearchSlice(set),
    }))
  ).getState();
