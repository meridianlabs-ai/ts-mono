import { createApplyTheme } from "@tsmono/theme/bootstrap";

import { SETTINGS_STORAGE_KEY } from "./resolveTheme";

declare global {
  interface Window {
    // Back-compat alias: existing callers (App.tsx effect, index.html) still
    // poke the scout-specific global. createApplyTheme also installs the
    // generic window.__APPLY_BROWSER_THEME__.
    __SCOUT_APPLY_BROWSER_THEME__?: () => void;
  }
}

const applyTheme = createApplyTheme({
  queryParamName: "inspectViewThemeCategory",
  storageKey: SETTINGS_STORAGE_KEY,
});

window.__SCOUT_APPLY_BROWSER_THEME__ = applyTheme;
applyTheme();
