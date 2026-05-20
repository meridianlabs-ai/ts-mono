import { FC } from "react";

import { ThemeToggle } from "@tsmono/react/components";
import { isVscode } from "@tsmono/util";

import { useUserSettings } from "../state/userSettings";

import { resolveIsDark, THEME_OPTIONS } from "./resolveTheme";

/**
 * Binds the shared ThemeToggle to scout's zustand-persisted preference.
 * Scout's App.tsx already re-applies the theme whenever themePreference
 * changes (useThemePreferenceSync), so this only has to write the store.
 */
export const ThemeToggleControl: FC = () => {
  const value = useUserSettings((s) => s.themePreference);
  const setValue = useUserSettings((s) => s.setThemePreference);
  // In VS Code the host owns the theme; the picker is inert there.
  if (isVscode()) return null;
  return (
    <ThemeToggle
      value={value}
      isDark={resolveIsDark(value)}
      options={THEME_OPTIONS}
      onChange={setValue}
    />
  );
};
