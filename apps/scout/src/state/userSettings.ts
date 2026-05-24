import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ThemePreference } from "@tsmono/inspect-common/theme/bootstrap";

export type { ThemePreference };

export const SETTINGS_STORAGE_KEY = "inspect-scout-user-settings";

export interface ColumnPreset {
  name: string;
  columns: string[];
}

const MAX_SEARCH_MODEL_HISTORY = 25;

interface UserSettingsState {
  dataframeColumnPresets: ColumnPreset[];
  themePreference: ThemePreference;
  searchModelHistory: string[];
  setDataframeColumnPresets: (presets: ColumnPreset[]) => void;
  setThemePreference: (themePreference: ThemePreference) => void;
  recordSearchModel: (model: string) => void;
  clearSearchModelHistory: () => void;
}

export const useUserSettings = create<UserSettingsState>()(
  persist(
    (set) => ({
      dataframeColumnPresets: [],
      themePreference: "system",
      searchModelHistory: [],
      setDataframeColumnPresets: (presets: ColumnPreset[]) => {
        set({ dataframeColumnPresets: presets });
      },
      setThemePreference: (themePreference: ThemePreference) => {
        set({ themePreference });
      },
      recordSearchModel: (model: string) => {
        const trimmedModel = model.trim();
        if (!trimmedModel) {
          return;
        }

        const normalizedModel = trimmedModel.toLowerCase();
        set((state) => ({
          searchModelHistory: [
            trimmedModel,
            ...state.searchModelHistory.filter(
              (existingModel) =>
                existingModel.trim().toLowerCase() !== normalizedModel
            ),
          ].slice(0, MAX_SEARCH_MODEL_HISTORY),
        }));
      },
      clearSearchModelHistory: () => {
        set({ searchModelHistory: [] });
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
