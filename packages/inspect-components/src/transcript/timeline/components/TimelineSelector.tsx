import clsx from "clsx";
import { FC, useCallback, useRef, useState } from "react";

import { useEventListener } from "@tsmono/react/hooks";
import { Icon } from "@tsmono/react/icons";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleSelect = useCallback(
    (index: number) => {
      onSelect(index);
      setIsOpen(false);
    },
    [onSelect]
  );

  useEventListener(
    isOpen ? window : null,
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      // This Escape closes the menu and nothing else: stop it here (the
      // capture-phase registration below runs first) so an enclosing
      // surface's own Escape handler — e.g. Modal's, on document bubble —
      // doesn't also fire and close both layers at once.
      e.stopPropagation();
      // Only pull focus back to the trigger when it was inside the menu.
      const refocus =
        containerRef.current?.contains(document.activeElement) ?? false;
      setIsOpen(false);
      if (refocus) triggerRef.current?.focus();
    },
    { capture: true }
  );

  if (timelines.length <= 1) return null;

  const active = timelines[activeIndex];
  if (!active) return null;

  return (
    <div ref={containerRef} className={styles.selectorContainer}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.selectorButton}
        onClick={() => setIsOpen((prev) => !prev)}
        title={active.description}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {active.name}
        <Icon name="chevronDown" className={styles.chevron} />
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
