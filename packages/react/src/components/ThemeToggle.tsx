import clsx from "clsx";
import { useEffect, useId, useState } from "react";

import { PopOver } from "./PopOver";
import styles from "./ThemeToggle.module.css";

export interface ThemeOption<T extends string> {
  value: T;
  label: string;
}

export interface ThemeToggleProps<T extends string> {
  /** The persisted preference (a value from `options`). */
  value: T;
  /** Resolved dark/light, so the button can show the current mode. */
  isDark: boolean;
  options: readonly ThemeOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /**
   * Hide the light/dark mode radios — used inside VS Code/Cursor where the
   * host owns base mode and the viewer can only safely flip Event Colors.
   */
  hideModeSwitch?: boolean;
}

type ThemeMode = "system" | "light" | "dark";

/**
 * Header control: clicking opens the full theme menu. Purely presentational:
 * the host owns persistence and supplies the option list.
 */
export const ThemeToggle = <T extends string>({
  value,
  isDark,
  options,
  onChange,
  className,
  hideModeSwitch,
}: ThemeToggleProps<T>) => {
  const id = useId();
  const [buttonEl, setButtonEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  // `base` is the persisted preference's mode axis (may be `system`); `mode`
  // is just what the radios show as selected (concrete light/dark, falling
  // back to the host-resolved `isDark` when base is `system`). Splitting
  // them keeps "follow OS / host" intact when Event Colors is toggled.
  const stripped =
    value.startsWith("readable-") ? value.slice("readable-".length) : value;
  const base: ThemeMode =
    stripped === "light" || stripped === "dark" ? stripped : "system";
  const mode: "light" | "dark" =
    base === "system" ? (isDark ? "dark" : "light") : base;
  const eventColors = value.startsWith("readable-");

  const optionValue = (nextBase: ThemeMode, nextEventColors: boolean) => {
    const nextValue = nextEventColors ? `readable-${nextBase}` : nextBase;
    return options.find((opt) => opt.value === nextValue)?.value;
  };

  const setPreference = (
    nextBase: ThemeMode,
    nextEventColors = eventColors
  ) => {
    const nextValue = optionValue(nextBase, nextEventColors);
    if (nextValue) onChange(nextValue);
  };

  const resetValue = options.find((opt) => opt.value === "system")?.value;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonEl?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [buttonEl, open]);

  return (
    <div className={clsx(styles.root, className)}>
      <button
        ref={setButtonEl}
        type="button"
        className={styles.button}
        aria-label="Choose theme"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i
          className={clsx(
            "bi",
            isDark ? "bi-moon-stars-fill" : "bi-sun-fill",
            styles.icon
          )}
          aria-hidden="true"
        />
      </button>
      <PopOver
        id="theme-toggle-popover"
        isOpen={open}
        setIsOpen={setOpen}
        positionEl={buttonEl}
        placement="bottom-end"
        showArrow={false}
        hoverDelay={-1}
        closeOnMouseLeave={false}
        offset={[0, 1]}
        className={styles.menu}
      >
        <div className={styles.headerRow}>
          <b>Theme</b>
          {resetValue && (
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => onChange(resetValue)}
            >
              Reset
            </button>
          )}
        </div>
        <fieldset className={styles.group} hidden={hideModeSwitch}>
          <legend className={styles.srOnly}>Theme mode</legend>
          {(["light", "dark"] as const).map((themeMode) => (
            <label key={themeMode} className={styles.option}>
              <input
                type="radio"
                name={`${id}-theme-mode`}
                value={themeMode}
                checked={mode === themeMode}
                onChange={() => setPreference(themeMode)}
              />
              <span>
                {themeMode.charAt(0).toUpperCase() + themeMode.slice(1)}
              </span>
            </label>
          ))}
        </fieldset>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={eventColors}
            onChange={() => setPreference(base, !eventColors)}
          />
          <span>Event Colors</span>
        </label>
      </PopOver>
    </div>
  );
};
