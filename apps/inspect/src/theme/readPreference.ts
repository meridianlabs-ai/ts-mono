import {
  isThemePreference,
  type ThemePreference,
} from "@tsmono/inspect-common/theme/bootstrap";

import { SETTINGS_STORAGE_KEY } from "./constants";

// Dependency-free read of the persisted theme preference, used by the inline
// bootstrap <script> (esbuild-bundled before the app loads, so it must not
// pull in React/zustand). The blob shape (`{ state: { themePreference } }`)
// is what zustand's persist middleware writes for useUserSettings, so the
// bootstrap and the store share one source of truth.
export const readThemePreference = (
  storage: Pick<Storage, "getItem"> = localStorage
): ThemePreference => {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return "system";
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "state" in parsed) {
      const state = parsed.state;
      if (state && typeof state === "object" && "themePreference" in state) {
        const value = state.themePreference;
        if (isThemePreference(value)) return value;
      }
    }
    return "system";
  } catch {
    return "system";
  }
};
