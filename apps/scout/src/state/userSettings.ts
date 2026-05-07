import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface ColumnPreset {
  name: string;
  columns: string[];
}

export type ThemePreference = "system" | "light" | "dark";

interface UserSettingsState {
  dataframeColumnPresets: ColumnPreset[];
  themePreference: ThemePreference;
  setDataframeColumnPresets: (presets: ColumnPreset[]) => void;
  setThemePreference: (themePreference: ThemePreference) => void;
}

export const useUserSettings = create<UserSettingsState>()(
  persist(
    (set) => ({
      dataframeColumnPresets: [],
      themePreference: "system",
      setDataframeColumnPresets: (presets: ColumnPreset[]) => {
        set({ dataframeColumnPresets: presets });
      },
      setThemePreference: (themePreference: ThemePreference) => {
        set({ themePreference });
      },
    }),
    {
      name: "inspect-scout-user-settings",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
