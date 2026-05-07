import {
  VscodeOption,
  VscodeSingleSelect,
} from "@vscode-elements/react-elements";
import { FC } from "react";

import { useDocumentTitle } from "@tsmono/react/hooks";

import { ThemePreference, useUserSettings } from "../../state/userSettings";

import styles from "./SettingsPanel.module.css";

const isThemePreference = (value: string): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

export const SettingsPanel: FC = () => {
  useDocumentTitle("Settings");

  const themePreference = useUserSettings((s) => s.themePreference);
  const setThemePreference = useUserSettings((s) => s.setThemePreference);

  const handleThemeChange = (e: Event) => {
    const value =
      e.target !== null &&
      "value" in e.target &&
      typeof e.target.value === "string"
        ? e.target.value
        : "";
    if (isThemePreference(value)) {
      setThemePreference(value);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Settings</h1>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Appearance</h2>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="theme-preference">
            Theme
          </label>
          <VscodeSingleSelect
            id="theme-preference"
            className={styles.select}
            value={themePreference}
            onChange={handleThemeChange}
          >
            <VscodeOption value="system">System</VscodeOption>
            <VscodeOption value="light">Light</VscodeOption>
            <VscodeOption value="dark">Dark</VscodeOption>
          </VscodeSingleSelect>
        </div>
      </section>
    </div>
  );
};
