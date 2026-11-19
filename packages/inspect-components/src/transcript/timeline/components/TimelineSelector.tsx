import clsx from "clsx";
import { FC, useCallback, useState } from "react";

import { AnchoredPopover } from "@tsmono/react/components";
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
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);

  const handleSelect = useCallback(
    (index: number) => {
      onSelect(index);
      setIsOpen(false);
    },
    [onSelect]
  );

  if (timelines.length <= 1) return null;

  const active = timelines[activeIndex];
  if (!active) return null;

  return (
    <div className={styles.selectorContainer}>
      <button
        ref={setTrigger}
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
      <AnchoredPopover
        open={isOpen}
        onClose={() => setIsOpen(false)}
        anchor={trigger}
        placement="bottom-start"
        offset={2}
        role="listbox"
        className={styles.dropdownMenu}
      >
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
      </AnchoredPopover>
    </div>
  );
};
