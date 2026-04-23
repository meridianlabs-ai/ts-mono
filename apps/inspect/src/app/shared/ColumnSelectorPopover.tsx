import { ColDef } from "ag-grid-community";
import { clsx } from "clsx";
import { FC, useMemo } from "react";

import { PopOver, SegmentedControl } from "@tsmono/react/components";

import { ApplicationIcons } from "../appearance/icons";
import { getFieldKey } from "../shared/gridUtils";

import styles from "./ColumnSelectorPopover.module.css";

export type ColumnScoresViewMode = "by-metric" | "per-scorer";

interface ColumnSelectorPopoverProps<T> {
  showing: boolean;
  setShowing: (showing: boolean) => void;
  columns: ColDef<T>[];
  onVisibilityChange: (visibility: Record<string, boolean>) => void;
  positionEl: HTMLElement | null;
  filteredFields?: string[];
  scoresHeading?: string;
  /**
   * When true, renders a "By Metric" / "Per Scorer" segmented control in the
   * scores section header. The caller controls which view is active and owns
   * persistence; this component just dispatches the change.
   */
  groupableScores?: boolean;
  scoresViewMode?: ColumnScoresViewMode;
  onScoresViewModeChange?: (mode: ColumnScoresViewMode) => void;
}

// Fields that belong in the scores section. Covers both per-scorer
// `score_<scorer>/<metric>` fields and the synthetic by-metric
// `metric_<metricName>` fields emitted by useLogListColumns.
const isScoreField = (field: string): boolean =>
  field.startsWith("score_") || field.startsWith("metric_");

export const ColumnSelectorPopover = <T,>({
  showing,
  setShowing,
  columns,
  onVisibilityChange,
  positionEl,
  filteredFields = [],
  scoresHeading = "Scorers",
  groupableScores = false,
  scoresViewMode = "by-metric",
  onScoresViewModeChange,
}: ColumnSelectorPopoverProps<T>): ReturnType<FC> => {
  // Get current visibility directly from columns
  const currentVisibility = useMemo(
    () =>
      columns.reduce<Record<string, boolean>>(
        (acc, col) => ({ ...acc, [getFieldKey(col)]: !col.hide }),
        {}
      ),
    [columns]
  );

  const handleToggle = (field: string) => {
    onVisibilityChange({
      ...currentVisibility,
      [field]: !currentVisibility[field],
    });
  };

  // Group columns by category - merge optional into base for this dialog
  const columnGroups = useMemo(() => {
    return {
      base: columns.filter((col) => !isScoreField(getFieldKey(col))),
      scores: columns.filter((col) => isScoreField(getFieldKey(col))),
    };
  }, [columns]);

  const handleSelectAllBase = () => {
    onVisibilityChange({
      ...currentVisibility,
      ...Object.fromEntries(
        columnGroups.base.map((col) => [getFieldKey(col), true])
      ),
    });
  };
  const handleDeselectAllBase = () => {
    onVisibilityChange({
      ...currentVisibility,
      ...Object.fromEntries(
        columnGroups.base.map((col) => [getFieldKey(col), false])
      ),
    });
  };
  const handleSelectAllScores = () => {
    onVisibilityChange({
      ...currentVisibility,
      ...Object.fromEntries(
        columnGroups.scores.map((col) => [getFieldKey(col), true])
      ),
    });
  };
  const handleDeselectAllScores = () => {
    onVisibilityChange({
      ...currentVisibility,
      ...Object.fromEntries(
        columnGroups.scores.map((col) => [getFieldKey(col), false])
      ),
    });
  };

  const renderColumnCheckbox = (col: ColDef<T>) => {
    const field = getFieldKey(col);
    const hasFilter = filteredFields.includes(field);
    return (
      <div
        key={field}
        className={styles.checkboxWrapper}
        title={
          hasFilter
            ? "Unselecting will remove an active filter on this column"
            : undefined
        }
      >
        <label className={styles.label}>
          <input
            type="checkbox"
            checked={currentVisibility[field]}
            onChange={() => handleToggle(field)}
            className={styles.checkbox}
          />
          <span>{col.headerName || field}</span>
          {hasFilter && (
            <i className={`${ApplicationIcons.filter} ${styles.filterIcon}`} />
          )}
        </label>
      </div>
    );
  };

  return (
    <PopOver
      id="column-selector-popover"
      isOpen={showing}
      setIsOpen={setShowing}
      positionEl={positionEl}
      placement="bottom-start"
      showArrow={false}
      hoverDelay={-1}
      className={styles.popover}
    >
      <div className={clsx(styles.scrollableContainer, "text-size-small")}>
        <div className={clsx(styles.section)}>
          <div className={styles.headerRow}>
            <b>Base</b>
            <div className={clsx(styles.buttonContainer, "text-size-small")}>
              <a
                className={clsx(styles.button, "text-size-small")}
                onClick={handleSelectAllBase}
              >
                All
              </a>
              |
              <a
                className={clsx(styles.button)}
                onClick={handleDeselectAllBase}
              >
                None
              </a>
            </div>
          </div>
          <div className={styles.columnsLayout}>
            {columnGroups.base.map((col) => renderColumnCheckbox(col))}
          </div>
        </div>

        {columnGroups.scores.length > 0 && (
          <div>
            <div className={styles.headerRow}>
              <div className={styles.scoresHeadingGroup}>
                <b>{scoresHeading}</b>
                {groupableScores && onScoresViewModeChange && (
                  <div className={styles.scoresViewModeControl}>
                    <SegmentedControl
                      id="column-selector-scores-view-mode"
                      segments={[
                        { id: "by-metric", label: "By Metric" },
                        { id: "per-scorer", label: "Per Scorer" },
                      ]}
                      selectedId={scoresViewMode}
                      onSegmentChange={(id) =>
                        onScoresViewModeChange(id as ColumnScoresViewMode)
                      }
                    />
                  </div>
                )}
              </div>
              <div className={styles.buttonContainer}>
                <a
                  className={clsx(styles.button)}
                  onClick={handleSelectAllScores}
                >
                  All
                </a>
                |
                <a
                  className={clsx(styles.button)}
                  onClick={handleDeselectAllScores}
                >
                  None
                </a>
              </div>
            </div>
            <div className={styles.columnsLayout}>
              {columnGroups.scores.map((col) => renderColumnCheckbox(col))}
            </div>
          </div>
        )}
      </div>
    </PopOver>
  );
};
