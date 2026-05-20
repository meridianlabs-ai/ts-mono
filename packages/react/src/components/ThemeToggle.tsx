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
}

type ThemeMode = "light" | "dark";

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
}: ThemeToggleProps<T>) => {
  const id = useId();
  const [buttonEl, setButtonEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const mode: ThemeMode =
    value.endsWith("-light") || value === "light"
      ? "light"
      : value.endsWith("-dark") || value === "dark"
        ? "dark"
        : isDark
          ? "dark"
          : "light";
  const eventColors = value.startsWith("readable-");

  const optionValue = (nextMode: ThemeMode, nextEventColors: boolean) => {
    const nextValue = nextEventColors ? `readable-${nextMode}` : nextMode;
    return options.find((opt) => opt.value === nextValue)?.value;
  };

  const setPreference = (
    nextMode: ThemeMode,
    nextEventColors = eventColors
  ) => {
    const nextValue = optionValue(nextMode, nextEventColors);
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
        <fieldset className={styles.group}>
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
            onChange={() => setPreference(mode, !eventColors)}
          />
          <span>Event Colors</span>
        </label>
      </PopOver>
    </div>
  );
};
