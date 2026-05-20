import { useCallback, useSyncExternalStore } from "react";

import {
  isThemePreference,
  resolveIsDark,
  subscribeHostTheme,
  type ThemePreference,
} from "@tsmono/theme/bootstrap";

import { SETTINGS_STORAGE_KEY } from "./constants";

// Inspect has no general settings store, so theme preference gets its own
// tiny localStorage record. The shape (`{ state: { themePreference }, ... }`)
// deliberately matches what @tsmono/theme/bootstrap's readThemePreference
// parses, so the inline bootstrap and this hook share one source of truth.
export { SETTINGS_STORAGE_KEY };

const read = (): ThemePreference => {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return "system";
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "state" in parsed &&
      parsed.state &&
      typeof parsed.state === "object" &&
      "themePreference" in parsed.state &&
      isThemePreference(parsed.state.themePreference)
    ) {
      return parsed.state.themePreference;
    }
  } catch {
    /* fall through */
  }
  return "system";
};

const listeners = new Set<() => void>();

const write = (value: ThemePreference): void => {
  localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({ state: { themePreference: value }, version: 0 })
  );
  // Re-resolve immediately (bootstrap installed this global).
  window.__APPLY_BROWSER_THEME__?.();
  listeners.forEach((l) => l());
};

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  // Cross-tab changes also re-render.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SETTINGS_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  // Host theme swap (VS Code/Cursor flipping `vscode-dark` ↔ `vscode-light`)
  // changes what `resolveIsDark("system")` returns, so the sun/moon icon
  // and any UI keyed off it must re-render.
  const unsubHost = subscribeHostTheme(cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
    unsubHost();
  };
};

export { resolveIsDark };

/** `[preference, setPreference]`, persisted + applied synchronously. */
export const useThemePreference = (): [
  ThemePreference,
  (value: ThemePreference) => void,
] => {
  const value = useSyncExternalStore(
    subscribe,
    read,
    (): ThemePreference => "system"
  );
  const set = useCallback((v: ThemePreference) => write(v), []);
  return [value, set];
};
