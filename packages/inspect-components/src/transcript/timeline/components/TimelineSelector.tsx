import clsx from "clsx";
import { FC, useCallback, useEffect, useState } from "react";

import type { Timeline } from "../core";

import styles from "./TimelineSelector.module.css";

// =============================================================================
// Types
// =============================================================================

export interface TimelineSelectorProps {
  /** Available timeline views. */
  timelines: ReadonlyArray<Timeline>;
  /** Index of the active timeline. */
  activeIndex: number;
  /** Called when a timeline is selected. */
  onSelect: (index: number) => void;
}

// =============================================================================
// Component
// =============================================================================

export const TimelineSelector: FC<TimelineSelectorProps> = ({
  timelines,
  activeIndex,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback(
    (index: number) => {
      onSelect(index);
      setIsOpen(false);
    },
    [onSelect]
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  if (timelines.length <= 1) return null;

  const active = timelines[activeIndex];
  if (!active) return null;

  return (
    <div className={styles.selectorContainer}>
      <button
        type="button"
        className={styles.selectorButton}
        onClick={() => setIsOpen((prev) => !prev)}
        title={active.description}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {active.name}
        <i
          className={clsx("bi-chevron-down", styles.chevron)}
          aria-hidden="true"
        />
      </button>
      {isOpen && (
        <>
          {/* Mouse-only dismissal; Escape closes the menu. */}
          <div
            className={styles.backdrop}
            role="presentation"
            onClick={() => setIsOpen(false)}
          />
          <div className={styles.dropdownMenu} role="listbox">
            {timelines.map((tl, i) => (
              <button
                key={tl.name}
                type="button"
                className={clsx(
                  styles.dropdownItem,
                  i === activeIndex && styles.dropdownItemActive
                )}
                role="option"
                aria-selected={i === activeIndex}
                onClick={() => handleSelect(i)}
              >
                {tl.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
