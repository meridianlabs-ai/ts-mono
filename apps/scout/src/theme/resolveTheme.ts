// Theme resolution now lives in @tsmono/theme/bootstrap so inspect, scout
// and hawk share one implementation. This module re-exports it and pins
// scout's own localStorage key.

export {
  isThemePreference,
  readThemePreference,
  resolveIsDark,
  resolveTheme,
  THEME_OPTIONS,
} from "@tsmono/theme/bootstrap";
export type {
  ResolveInput,
  ResolveOutput,
  ThemePreference,
  ThemeVariant,
} from "@tsmono/theme/bootstrap";

export const SETTINGS_STORAGE_KEY = "inspect-scout-user-settings";
