import { clsx } from "clsx";
import { FC } from "react";

import { PopOver, SegmentedControl } from "@tsmono/react/components";
import { Icon } from "@tsmono/react/icons";

import styles from "./ColumnSelectorPopover.module.css";

/** A column the picker can show or hide. `id` keys the visibility map. */
export interface PickerColumn {
  id: string;
  label: string;
  /** Hover text for the column's checkbox. */
  title?: string;
}

export type ColumnScoresViewMode = "by-metric" | "per-scorer";

const isColumnScoresViewMode = (value: string): value is ColumnScoresViewMode =>
  value === "by-metric" || value === "per-scorer";

interface ColumnSelectorPopoverProps {
  id: string;
  showing: boolean;
  setShowing: (showing: boolean) => void;
  positionEl: HTMLElement | null;
  columns: PickerColumn[];
  /** Keyed by column id; a column missing from the map is visible. */
  visibility: Record<string, boolean>;
  onVisibilityChange: (visibility: Record<string, boolean>) => void;
  /** Ids of columns with an active filter; they get a filter icon. */
  filteredFields?: string[];
  /** When set, score columns are listed in their own section under this
   *  heading. */
  scoresHeading?: string;
  /** When set, the scores section gets a "By Metric" / "Per Scorer"
   *  control. The caller owns the mode and its persistence. */
  scoresViewMode?: ColumnScoresViewMode;
  onScoresViewModeChange?: (mode: ColumnScoresViewMode) => void;
  /** When set, a "Default" link resets the columns to the caller's
   *  defaults. */
  onResetToDefault?: () => void;
}

// Covers both per-scorer `score_<scorer>/<metric>` fields and the synthetic
// by-metric `metric_<metricName>` fields the log list emits.
const isScoreField = (field: string): boolean =>
  field.startsWith("score_") || field.startsWith("metric_");

export const ColumnSelectorPopover: FC<ColumnSelectorPopoverProps> = ({
  id,
  showing,
  setShowing,
  positionEl,
  columns,
  visibility,
  onVisibilityChange,
  filteredFields = [],
  scoresHeading,
  scoresViewMode = "by-metric",
  onScoresViewModeChange,
  onResetToDefault,
}) => {
  const isVisible = (columnId: string) => visibility[columnId] !== false;

  const setVisible = (changed: PickerColumn[], visible: boolean) => {
    onVisibilityChange({
      ...Object.fromEntries(columns.map((col) => [col.id, isVisible(col.id)])),
      ...Object.fromEntries(changed.map((col) => [col.id, visible])),
    });
  };

  const base = scoresHeading
    ? columns.filter((col) => !isScoreField(col.id))
    : columns;
  const scores = scoresHeading
    ? columns.filter((col) => isScoreField(col.id))
    : [];

  const renderColumnCheckbox = (col: PickerColumn) => {
    const hasFilter = filteredFields.includes(col.id);
    const title = [
      col.title,
      hasFilter
        ? "Unselecting will remove an active filter on this column"
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    return (
      <div
        key={col.id}
        className={styles.checkboxWrapper}
        title={title || undefined}
      >
        <label className={styles.label}>
          <input
            type="checkbox"
            checked={isVisible(col.id)}
            onChange={() => setVisible([col], !isVisible(col.id))}
            className={styles.checkbox}
          />
          <span>{col.label || col.id}</span>
          {hasFilter && <Icon name="filter" className={styles.filterIcon} />}
        </label>
      </div>
    );
  };

  return (
    <PopOver
      id={id}
      isOpen={showing}
      setIsOpen={setShowing}
      positionEl={positionEl}
      placement="bottom-end"
      showArrow={false}
      hoverDelay={-1}
      closeOnMouseLeave={false}
      offset={1}
    >
      <div className={clsx(styles.scrollableContainer, "text-size-small")}>
        <div className={styles.section}>
          <div className={styles.headerRow}>
            <b>{scoresHeading ? "Base" : "Columns"}</b>
            <div className={styles.buttonContainer}>
              <button
                type="button"
                className={styles.button}
                onClick={() => setVisible(base, true)}
              >
                All
              </button>
              |
              <button
                type="button"
                className={styles.button}
                onClick={() => setVisible(base, false)}
              >
                None
              </button>
              {onResetToDefault && (
                <>
                  |
                  <button
                    type="button"
                    className={styles.button}
                    onClick={onResetToDefault}
                  >
                    Default
                  </button>
                </>
              )}
            </div>
          </div>
          <div className={styles.columnsLayout}>
            {base.map(renderColumnCheckbox)}
          </div>
        </div>

        {scores.length > 0 && (
          <div>
            <div className={styles.headerRow}>
              <div className={styles.scoresHeadingGroup}>
                <b>{scoresHeading}</b>
                {onScoresViewModeChange && (
                  <div className={styles.scoresViewModeControl}>
                    <SegmentedControl
                      id={`${id}-scores-view-mode`}
                      segments={[
                        { id: "by-metric", label: "By Metric" },
                        { id: "per-scorer", label: "Per Scorer" },
                      ]}
                      selectedId={scoresViewMode}
                      onSegmentChange={(mode) =>
                        isColumnScoresViewMode(mode) &&
                        onScoresViewModeChange(mode)
                      }
                    />
                  </div>
                )}
              </div>
              <div className={styles.buttonContainer}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setVisible(scores, true)}
                >
                  All
                </button>
                |
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setVisible(scores, false)}
                >
                  None
                </button>
              </div>
            </div>
            <div className={styles.columnsLayout}>
              {scores.map(renderColumnCheckbox)}
            </div>
          </div>
        )}
      </div>
    </PopOver>
  );
};
