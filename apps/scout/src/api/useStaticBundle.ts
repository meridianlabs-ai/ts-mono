import { useApi } from "../state/store";

/**
 * Returns true when the app is running against a static bundle (no backend).
 * UI surfaces that would require live server compute — search, validation
 * editing, project config edits, scan launching — should hide themselves
 * via this hook.
 *
 * This is the only static-bundle signal: it derives from the api object
 * created in main.tsx, so it must be consulted at render time (module-eval
 * code runs before the api exists).
 */
export const useStaticBundle = (): boolean => useApi().readOnly;
