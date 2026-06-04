import clsx from "clsx";
import { FC } from "react";

import styles from "./ActivityRail.module.css";

export type ActivityRailItemId = "search" | "scans";

export interface ActivityRailItem {
  id: ActivityRailItemId;
  label: string;
  icon: string;
  disabled?: boolean;
  title?: string;
}

export interface ActivityRailProps {
  items: ActivityRailItem[];
  active: ActivityRailItemId | null;
  onSelect: (id: ActivityRailItemId) => void;
  className?: string;
}

/**
 * Vertical activity bar (VS Code style) hosting the sample-view sidebar
 * entries. Always visible; the active item's panel opens to its left.
 */
export const ActivityRail: FC<ActivityRailProps> = ({
  items,
  active,
  onSelect,
  className,
}) => (
  <div
    className={clsx(styles.rail, className)}
    role="tablist"
    aria-orientation="vertical"
  >
    {items.map((item) => {
      const isActive = active === item.id;
      return (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          disabled={item.disabled}
          title={item.title ?? item.label}
          className={clsx(styles.item, isActive && styles.itemActive)}
          onClick={() => onSelect(item.id)}
        >
          <i className={clsx(item.icon, styles.icon)} aria-hidden="true" />
          <span className={clsx(styles.label, "text-size-smallest")}>
            {item.label}
          </span>
        </button>
      );
    })}
  </div>
);
