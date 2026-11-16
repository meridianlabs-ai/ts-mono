import clsx from "clsx";
import { FC, useState } from "react";

import { AnchoredPopover } from "@tsmono/react/components";
import { Icon } from "@tsmono/react/icons";

import styles from "./EventNavsPicker.module.css";

interface EventNavsPickerProps {
  navs: Array<{ id: string; title: string; target: string }>;
  selectedNav: string;
  setSelectedNav: (target: string) => void;
  /** Natural width (px) of the longest option's text — sets the label's
   *  preferred width so the button is wide enough to fit any selection
   *  without truncation when there's room. */
  labelWidth?: number;
}

/**
 * Compact replacement for {@link EventNavs} when the tab row is too narrow
 * to display all pills inline. Renders the active tab title as a single
 * button that opens an anchored menu of all navs.
 */
export const EventNavsPicker: FC<EventNavsPickerProps> = ({
  navs,
  selectedNav,
  setSelectedNav,
  labelWidth,
}) => {
  const [open, setOpen] = useState(false);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);

  const selected = navs.find((nav) => nav.target === selectedNav) ?? navs[0];

  return (
    <>
      <button
        ref={setButton}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          "nav-link",
          "active",
          "text-style-label",
          "text-size-small",
          styles.trigger
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={styles.label}
          style={labelWidth ? { width: labelWidth } : undefined}
        >
          {selected?.title ?? ""}
        </span>
        <Icon name="chevronDown" className={styles.chevron} />
      </button>
      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchor={button}
        placement="bottom-end"
        offset={0}
        role="listbox"
        tabIndex={-1}
        className={styles.menu}
      >
        {navs.map((nav) => {
          const isSelected = nav.target === selectedNav;
          return (
            <button
              key={nav.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={clsx(
                styles.item,
                isSelected ? styles.selected : undefined,
                "text-size-small"
              )}
              onClick={() => {
                setSelectedNav(nav.target);
                setOpen(false);
              }}
            >
              {nav.title}
            </button>
          );
        })}
      </AnchoredPopover>
    </>
  );
};
