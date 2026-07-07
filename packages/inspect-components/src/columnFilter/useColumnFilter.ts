import { useCallback, useEffect, useRef, useState } from "react";

import {
  LIST_VALUE_OPERATORS,
  NO_VALUE_OPERATORS,
  OPERATORS_BY_TYPE,
  RANGE_VALUE_OPERATORS,
} from "./operators";
import { specToCondition } from "./specToCondition";
import type { FilterSpec, FilterType, UiOperator } from "./types";

export interface UseColumnFilterParams {
  columnId: string;
  filterType: FilterType;
  /** The column's applied filter (editor state re-syncs from it on open). */
  spec: FilterSpec | null;
  isOpen: boolean;
  /** Override the operator choices (defaults to the full set for the type). */
  operators?: UiOperator[];
}

export interface UseColumnFilterReturn {
  operator: UiOperator;
  setOperator: (operator: UiOperator) => void;
  operatorOptions: UiOperator[];
  value: string;
  setValue: (value: string) => void;
  /** Second value for between/not between operators */
  value2: string;
  setValue2: (value: string) => void;
  /** True if the operator takes no value (is blank / is not blank) — the value input is disabled. */
  takesNoValue: boolean;
  /** True if operator expects a list of values (in / not in) */
  usesListValue: boolean;
  /** True if operator expects a range with two values (between / not between) */
  usesRangeValue: boolean;
  /**
   * Build the spec for the current editor state. `null` means "clear the
   * filter" (empty/incomplete value); `undefined` means the input doesn't
   * parse for this column's type (invalid — don't commit).
   */
  buildSpec: () => FilterSpec | null | undefined;
}

export function useColumnFilter({
  columnId,
  filterType,
  spec,
  isOpen,
  operators,
}: UseColumnFilterParams): UseColumnFilterReturn {
  const operatorOptions = operators ?? OPERATORS_BY_TYPE[filterType];
  const defaultOperator: UiOperator = operatorOptions[0] ?? "=";
  const [operator, setOperator] = useState<UiOperator>(
    spec?.operator ?? defaultOperator
  );
  const [value, setValue] = useState<string>(spec?.value ?? "");
  const [value2, setValue2] = useState<string>(spec?.value2 ?? "");

  // Track the previous columnId to detect when we switch to a different filter
  const prevColumnIdRef = useRef(columnId);

  // Sync state when closed OR when switching to a different column while
  // opening. Because closing re-syncs from the applied spec, edits abandoned
  // via click-outside are discarded.
  useEffect(() => {
    const columnChanged = prevColumnIdRef.current !== columnId;
    prevColumnIdRef.current = columnId;

    if (!isOpen || columnChanged) {
      setOperator(spec?.operator ?? defaultOperator);
      setValue(spec?.value ?? "");
      setValue2(spec?.value2 ?? "");
    }
  }, [spec, defaultOperator, isOpen, columnId]);

  const buildSpec = useCallback((): FilterSpec | null | undefined => {
    if (NO_VALUE_OPERATORS.has(operator)) {
      return { operator, value: "" };
    }
    const next: FilterSpec = {
      operator,
      value,
      value2: RANGE_VALUE_OPERATORS.has(operator) ? value2 : undefined,
    };
    // The wire compiler is the single authority on emptiness (null = clear)
    // and validity (undefined = don't commit); the future filtrex target
    // shares the same input-parsing rules.
    const compiled = specToCondition(columnId, filterType, next);
    if (compiled === undefined) return undefined;
    if (compiled === null) return null;
    return next;
  }, [columnId, filterType, operator, value, value2]);

  return {
    operator,
    setOperator,
    operatorOptions,
    value,
    setValue,
    value2,
    setValue2,
    takesNoValue: NO_VALUE_OPERATORS.has(operator),
    usesListValue: LIST_VALUE_OPERATORS.has(operator),
    usesRangeValue: RANGE_VALUE_OPERATORS.has(operator),
    buildSpec,
  };
}
