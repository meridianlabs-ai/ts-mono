import clsx from "clsx";
import { ChangeEvent, FC, KeyboardEvent, useCallback } from "react";

import type { ScalarValue } from "@tsmono/inspect-common/query";
import { AutocompleteInput } from "@tsmono/react/components";

import styles from "./ColumnFilterEditor.module.css";
import { DurationInput } from "./DurationInput";
import { OPERATOR_LABELS } from "./operators";
import type { FilterType, UiOperator } from "./types";

export interface ColumnFilterEditorProps {
  columnId: string;
  filterType: FilterType;
  operator: UiOperator;
  operatorOptions: UiOperator[];
  rawValue: string;
  /** Second value for between/not between operators */
  rawValue2?: string;
  isValueDisabled: boolean;
  /** True if operator expects a range with two values (between / not between) */
  isRangeOperator?: boolean;
  onOperatorChange: (operator: UiOperator) => void;
  onValueChange: (value: string) => void;
  /** Handler for second value changes (between / not between operators) */
  onValue2Change?: (value: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  suggestions?: ScalarValue[];
}

export const ColumnFilterEditor: FC<ColumnFilterEditorProps> = ({
  columnId,
  filterType,
  operator,
  operatorOptions,
  rawValue,
  rawValue2 = "",
  isValueDisabled,
  isRangeOperator = false,
  onOperatorChange,
  onValueChange,
  onValue2Change,
  onCommit,
  onCancel,
  suggestions = [],
}) => {
  const handleOperatorChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onOperatorChange(event.target.value as UiOperator);
    },
    [onOperatorChange]
  );

  const handleValueChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onValueChange(event.target.value);
    },
    [onValueChange]
  );

  const handleValue2Change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onValue2Change?.(event.target.value);
    },
    [onValue2Change]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Prevent parent (grid) bubbling
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel?.();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onCommit?.();
      }
    },
    [onCancel, onCommit]
  );

  return (
    <div className={styles.filterContent} onKeyDown={handleKeyDown}>
      <div className={styles.filterRow}>
        <select
          id={`${columnId}-op`}
          className={styles.filterSelect}
          value={operator}
          onChange={handleOperatorChange}
        >
          {operatorOptions.map((option) => (
            <option key={option} value={option}>
              {OPERATOR_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      {isRangeOperator && <span className={styles.rangeLabel}>Start</span>}
      <div className={styles.filterRow}>
        {filterType === "boolean" ? (
          <select
            id={`${columnId}-val`}
            className={styles.filterSelect}
            value={rawValue}
            onChange={handleValueChange}
            disabled={isValueDisabled}
            autoFocus
          >
            <option value="">(not set)</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : filterType === "string" || filterType === "unknown" ? (
          <AutocompleteInput
            id={`${columnId}-val`}
            value={rawValue}
            onChange={onValueChange}
            onCommit={onCommit}
            onCancel={onCancel}
            disabled={isValueDisabled}
            placeholder="Filter"
            suggestions={suggestions}
            className={styles.filterInput}
            autoFocus
            allowBrowse={true}
          />
        ) : filterType === "duration" ? (
          <DurationInput
            id={`${columnId}-val`}
            value={rawValue}
            onChange={handleValueChange}
            disabled={isValueDisabled}
            autoFocus
          />
        ) : (
          <input
            id={`${columnId}-val`}
            className={styles.filterInput}
            type={
              filterType === "number"
                ? "number"
                : filterType === "date"
                  ? "date"
                  : "datetime-local"
            }
            spellCheck="false"
            value={rawValue}
            onChange={handleValueChange}
            placeholder="Filter"
            disabled={isValueDisabled}
            step={filterType === "number" ? "any" : undefined}
            autoFocus
          />
        )}
      </div>
      {/* Second input for between/not between operators */}
      {isRangeOperator && (
        <>
          <span className={styles.rangeLabel}>End</span>
          <div className={styles.filterRow}>
            {filterType === "duration" ? (
              <DurationInput
                id={`${columnId}-val2`}
                value={rawValue2}
                onChange={handleValue2Change}
                disabled={isValueDisabled}
              />
            ) : (
              <input
                id={`${columnId}-val2`}
                className={styles.filterInput}
                type={
                  filterType === "number"
                    ? "number"
                    : filterType === "date"
                      ? "date"
                      : "datetime-local"
                }
                spellCheck="false"
                value={rawValue2}
                onChange={handleValue2Change}
                placeholder="Filter"
                disabled={isValueDisabled}
                step={filterType === "number" ? "any" : undefined}
              />
            )}
          </div>
        </>
      )}

      <div className={styles.filterRow}>
        <button
          className={clsx(
            "btn",
            "btn-outline-primary",
            styles.filterButton,
            "text-size-small"
          )}
          onClick={onCommit}
        >
          Apply
        </button>
      </div>
    </div>
  );
};
