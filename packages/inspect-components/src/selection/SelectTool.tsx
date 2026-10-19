import clsx from "clsx";
import { FC } from "react";

import { ToolButton } from "@tsmono/react/components";

import type { SelectableItem } from "./rowSelection";
import styles from "./SelectTool.module.css";

interface SelectToolProps {
  /** Selection mode is on (headers show checkboxes). */
  active: boolean;
  /** Number of selected items; with a selection the tool becomes a split
   *  button whose trailing segment clears the selection. */
  count: number;
  /** Toggle the mode. Exiting keeps the selection; re-entering shows it again. */
  onToggle: () => void;
  /** Clear the selection and leave the mode (the × segment). */
  onClear: () => void;
  /** What the rows are, for the titles; the visible label stays `Select`. */
  item: SelectableItem;
  className?: string;
}

/**
 * Toolbar toggle for evidence selection: `Select` (off), a latched
 * `Select` (on, nothing selected) or a latched split `Select · N | ×`, where
 * × clears the selection and exits the mode in one press.
 */
export const SelectTool: FC<SelectToolProps> = ({
  active,
  count,
  onToggle,
  onClear,
  item,
  className,
}) => {
  const hasSelection = active && count > 0;
  const title = !active
    ? `Select ${item}s`
    : count === 0
      ? `Click ${item}s to select · click again to exit`
      : "Exit select mode";
  return (
    <span className={clsx(styles.group, className)}>
      <ToolButton
        label={hasSelection ? `Select · ${count}` : "Select"}
        icon={active ? "selectionSelecting" : "selectionSelect"}
        latched={active}
        subtle
        className={hasSelection ? styles.splitMain : undefined}
        title={title}
        aria-pressed={active}
        onClick={onToggle}
      />
      {hasSelection ? (
        <ToolButton
          icon="selectionClear"
          latched
          subtle
          className={styles.splitClear}
          title="Clear selection and exit"
          aria-label="Clear selection and exit"
          onClick={onClear}
        />
      ) : null}
    </span>
  );
};
