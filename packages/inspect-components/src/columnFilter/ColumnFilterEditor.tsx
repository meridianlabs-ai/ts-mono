import clsx from "clsx";
import { ChangeEvent, FC, KeyboardEvent, useCallback } from "react";

import type { ScalarValue } from "@tsmono/inspect-common/query";
import { AutocompleteInput } from "@tsmono/react/components";

import styles from "./ColumnFilterEditor.module.css";
import { DurationInput } from "./DurationInput";
import { OPERATOR_LABELS } from "./operators";
import type { FilterType, UiOperator } from "./types";

interface FilterValueInputProps {
  id: string;
  filterType: FilterType;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoFocus?: boolean;
  suggestions?: ScalarValue[];
  onCommit?: () => void;
  onCancel?: () => void;
}

/** Renders the type-appropriate value control, shared by condition 1 and the
 *  optional second condition. */
const FilterValueInput: FC<FilterValueInputProps> = ({
  id,
  filterType,
  value,
  onChange,
  disabled,
  autoFocus = false,
  suggestions = [],
  onCommit,
  onCancel,
}) => {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onChange(event.target.value);
    },
    [onChange]
  );

  if (filterType === "boolean") {
    return (
      <select
        id={id}
        className={styles.filterSelect}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        autoFocus={autoFocus}
      >
        <option value="">(not set)</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (filterType === "string" || filterType === "unknown") {
    return (
      <AutocompleteInput
        id={id}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        onCancel={onCancel}
        disabled={disabled}
        placeholder="Filter"
        suggestions={suggestions}
        className={styles.filterInput}
        autoFocus={autoFocus}
        allowBrowse={true}
      />
    );
  }

  if (filterType === "duration") {
    return (
      <DurationInput
        id={id}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        autoFocus={autoFocus}
      />
    );
  }

  return (
    <input
      id={id}
      className={styles.filterInput}
      type={
        filterType === "number"
          ? "number"
          : filterType === "date"
            ? "date"
            : "datetime-local"
      }
      spellCheck="false"
      value={value}
      onChange={handleChange}
      placeholder="Filter"
      disabled={disabled}
      step={filterType === "number" ? "any" : undefined}
      autoFocus={autoFocus}
    />
  );
};

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

  /** Reveal the AND/OR + second-condition row once condition 1 has content. */
  showSecond?: boolean;
  join?: "and" | "or";
  onJoinChange?: (join: "and" | "or") => void;
  secondOperator?: UiOperator;
  onSecondOperatorChange?: (operator: UiOperator) => void;
  secondValue?: string;
  onSecondValueChange?: (value: string) => void;
  secondValue2?: string;
  onSecondValue2Change?: (value: string) => void;
  isSecondValueDisabled?: boolean;
  isSecondRangeOperator?: boolean;
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
  showSecond = false,
  join = "and",
  onJoinChange,
  secondOperator,
  onSecondOperatorChange,
  secondValue = "",
  onSecondValueChange,
  secondValue2 = "",
  onSecondValue2Change,
  isSecondValueDisabled = false,
  isSecondRangeOperator = false,
}) => {
  const handleOperatorChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onOperatorChange(event.target.value as UiOperator);
    },
    [onOperatorChange]
  );

  const handleValue2Change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onValue2Change?.(event.target.value);
    },
    [onValue2Change]
  );

  const handleJoinChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onJoinChange?.(event.target.value as "and" | "or");
    },
    [onJoinChange]
  );

  const handleSecondOperatorChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onSecondOperatorChange?.(event.target.value as UiOperator);
    },
    [onSecondOperatorChange]
  );

  const handleSecondValue2Change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onSecondValue2Change?.(event.target.value);
    },
    [onSecondValue2Change]
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
        <FilterValueInput
          id={`${columnId}-val`}
          filterType={filterType}
          value={rawValue}
          onChange={onValueChange}
          disabled={isValueDisabled}
          autoFocus
          suggestions={suggestions}
          onCommit={onCommit}
          onCancel={onCancel}
        />
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

      {showSecond && (
        <>
          <div className={clsx(styles.filterRow, styles.joinRow)}>
            <label className={styles.joinOption}>
              <input
                type="radio"
                name={`${columnId}-join`}
                value="and"
                checked={join === "and"}
                onChange={handleJoinChange}
              />
              AND
            </label>
            <label className={styles.joinOption}>
              <input
                type="radio"
                name={`${columnId}-join`}
                value="or"
                checked={join === "or"}
                onChange={handleJoinChange}
              />
              OR
            </label>
          </div>
          <div className={styles.filterRow}>
            <select
              id={`${columnId}-op2`}
              className={styles.filterSelect}
              value={secondOperator}
              onChange={handleSecondOperatorChange}
            >
              {operatorOptions.map((option) => (
                <option key={option} value={option}>
                  {OPERATOR_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          {isSecondRangeOperator && (
            <span className={styles.rangeLabel}>Start</span>
          )}
          <div className={styles.filterRow}>
            <FilterValueInput
              id={`${columnId}-val-b`}
              filterType={filterType}
              value={secondValue}
              onChange={(v) => onSecondValueChange?.(v)}
              disabled={isSecondValueDisabled}
              suggestions={suggestions}
              onCommit={onCommit}
              onCancel={onCancel}
            />
          </div>
          {isSecondRangeOperator && (
            <>
              <span className={styles.rangeLabel}>End</span>
              <div className={styles.filterRow}>
                {filterType === "duration" ? (
                  <DurationInput
                    id={`${columnId}-val-b2`}
                    value={secondValue2}
                    onChange={handleSecondValue2Change}
                    disabled={isSecondValueDisabled}
                  />
                ) : (
                  <input
                    id={`${columnId}-val-b2`}
                    className={styles.filterInput}
                    type={
                      filterType === "number"
                        ? "number"
                        : filterType === "date"
                          ? "date"
                          : "datetime-local"
                    }
                    spellCheck="false"
                    value={secondValue2}
                    onChange={handleSecondValue2Change}
                    placeholder="Filter"
                    disabled={isSecondValueDisabled}
                    step={filterType === "number" ? "any" : undefined}
                  />
                )}
              </div>
            </>
          )}
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
