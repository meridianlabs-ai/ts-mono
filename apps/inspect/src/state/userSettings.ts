import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ThemePreference } from "@tsmono/theme/apply-theme";

import { SETTINGS_STORAGE_KEY } from "../theme/constants";

export type { ThemePreference };
export { SETTINGS_STORAGE_KEY };

// Mirrors scout's userSettings: a single zustand-persisted store for
// localStorage-backed UI preferences, ready for more settings to land here
// rather than each growing its own bespoke record. The persisted key/shape is
// shared with the inline theme bootstrap, which reads it via
// `readThemePreference` (@tsmono/theme) with this same SETTINGS_STORAGE_KEY.
interface UserSettingsState {
  themePreference: ThemePreference;
  setThemePreference: (themePreference: ThemePreference) => void;
}

export const useUserSettings = create<UserSettingsState>()(
  persist(
    (set) => ({
      // Default to the readable (Event Colors) variant per product decision.
      themePreference: "readable-system",
      setThemePreference: (themePreference: ThemePreference) => {
        set({ themePreference });
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
