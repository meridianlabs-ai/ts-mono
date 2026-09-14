import clsx from "clsx";
import { FC } from "react";

import { ToolButton } from "@tsmono/react/components";

import { TranscriptIcons } from "../icons";

import styles from "./TranscriptSelectTool.module.css";

interface TranscriptSelectToolProps {
  /** Selection mode is on (event headers show checkboxes). */
  active: boolean;
  /** Number of selected events; with a selection the tool becomes a split
   *  button whose trailing segment clears the selection. */
  count: number;
  /** Toggle the mode. Exiting keeps the selection; re-entering shows it again. */
  onToggle: () => void;
  /** Clear the selection and leave the mode (the × segment). */
  onClear: () => void;
  className?: string;
}

/**
 * Toolbar toggle for transcript evidence selection: `Select` (off), a latched
 * `Select` (on, nothing selected) or a latched split `Select · N | ×`, where
 * × clears the selection and exits the mode in one press.
 */
export const TranscriptSelectTool: FC<TranscriptSelectToolProps> = ({
  active,
  count,
  onToggle,
  onClear,
  className,
}) => {
  const hasSelection = active && count > 0;
  const title = !active
    ? "Select events"
    : count === 0
      ? "Click events to select · click again to exit"
      : "Exit select mode";
  return (
    <span className={clsx(styles.group, className)}>
      <ToolButton
        label={hasSelection ? `Select · ${count}` : "Select"}
        icon={
          active
            ? TranscriptIcons.selection.selecting
            : TranscriptIcons.selection.select
        }
        latched={active}
        subtle
        className={hasSelection ? styles.splitMain : undefined}
        title={title}
        aria-pressed={active}
        onClick={onToggle}
      />
      {hasSelection ? (
        <ToolButton
          icon={TranscriptIcons.selection.clear}
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
