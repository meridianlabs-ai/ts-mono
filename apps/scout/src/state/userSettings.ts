import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface ColumnPreset {
  name: string;
  columns: string[];
}

const MAX_SEARCH_MODEL_HISTORY = 25;

interface UserSettingsState {
  dataframeColumnPresets: ColumnPreset[];
  searchModelHistory: string[];
  setDataframeColumnPresets: (presets: ColumnPreset[]) => void;
  recordSearchModel: (model: string) => void;
  clearSearchModelHistory: () => void;
}

export const useUserSettings = create<UserSettingsState>()(
  persist(
    (set) => ({
      dataframeColumnPresets: [],
      searchModelHistory: [],
      setDataframeColumnPresets: (presets: ColumnPreset[]) => {
        set({ dataframeColumnPresets: presets });
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
      name: "inspect-scout-user-settings",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
