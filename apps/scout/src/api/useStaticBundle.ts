import { useApi } from "../state/store";

/**
 * Returns true when the app is running against a static bundle (no backend).
 * UI surfaces that would require live server compute — search, validation
 * editing, project config edits, scan launching — should hide themselves
 * via this hook.
 *
 * For module-init code that runs before React (e.g. the router activities
 * list), use `window.__SCOUT_STATIC_BUNDLE__` directly — it is set in
 * main.tsx before any other module imports.
 */
export const useStaticBundle = (): boolean => useApi().readOnly === true;
