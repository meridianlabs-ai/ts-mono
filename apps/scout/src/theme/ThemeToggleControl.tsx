import { FC } from "react";

import { resolveIsDark } from "@tsmono/inspect-common/theme/bootstrap";
import { ThemeToggle } from "@tsmono/inspect-components/theme";
import { isVscode } from "@tsmono/util";

import { useUserSettings } from "../state/userSettings";

/**
 * Binds the shared ThemeToggle to scout's zustand-persisted preference.
 * Scout's App.tsx already re-applies the theme whenever themePreference
 * changes (useThemePreferenceSync), so this only has to write the store.
 */
export const ThemeToggleControl: FC = () => {
  const value = useUserSettings((s) => s.themePreference);
  const setValue = useUserSettings((s) => s.setThemePreference);
  return (
    <ThemeToggle
      value={value}
      isDark={resolveIsDark(value)}
      onChange={setValue}
      // In VS Code the host owns base mode, but Event Colors (variant) is
      // still safe to flip from inside.
      hideModeSwitch={isVscode()}
    />
  );
};
