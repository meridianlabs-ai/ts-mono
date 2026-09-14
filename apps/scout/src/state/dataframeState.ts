import type {
  ColumnPinningState,
  ColumnSizingState,
  SortingState,
} from "@tanstack/react-table";

import {
  isColumnFilter,
  type ColumnFilter,
  type FilterCondition,
  type FilterSpec,
  type UiOperator,
} from "@tsmono/inspect-components/columnFilter";
import { isRecord } from "@tsmono/util";

export const GRID_STATE_NAME = "DataframeView";

export interface DataframeState {
  sorting: SortingState;
  columnOrder: string[];
  columnSizing: ColumnSizingState;
  columnFilters: Record<string, ColumnFilter>;
  columnPinning: ColumnPinningState;
  scroll: { top: number; left: number };
}

export const emptyDataframeState: DataframeState = {
  sorting: [],
  columnOrder: [],
  columnSizing: {},
  columnFilters: {},
  columnPinning: { start: [], end: [] },
  scroll: { top: 0, left: 0 },
};

const legacyOperators: Record<string, UiOperator> = {
  contains: "contains",
  notContains: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  equals: "=",
  notEqual: "!=",
  lessThan: "<",
  lessThanOrEqual: "<=",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  inRange: "between",
  blank: "is blank",
  notBlank: "is not blank",
};

function legacyCondition(value: unknown): FilterCondition | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  const operator = legacyOperators[value.type];
  if (!operator) return undefined;
  const input = value.filter ?? value.dateFrom;
  const end = value.filterTo ?? value.dateTo;
  return {
    operator,
    value:
      typeof input === "string" || typeof input === "number"
        ? String(input).replace(/ 00:00:00$/, "")
        : "",
    ...(typeof end === "string" || typeof end === "number"
      ? { value2: String(end).replace(/ 00:00:00$/, "") }
      : {}),
  };
}

function legacyFilter(
  columnId: string,
  value: unknown
): ColumnFilter | undefined {
  if (!isRecord(value)) return undefined;
  const conditions: unknown[] = Array.isArray(value.conditions)
    ? value.conditions
    : [value.condition1, value.condition2];
  const first = legacyCondition(conditions[0]) ?? legacyCondition(value);
  if (!first) return undefined;
  const second = legacyCondition(conditions[1]);
  const spec: FilterSpec = second
    ? { ...first, join: value.operator === "OR" ? "or" : "and", second }
    : first;
  return {
    columnId,
    filterType:
      value.filterType === "number"
        ? "number"
        : value.filterType === "date"
          ? "date"
          : "string",
    spec,
  };
}

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const nonnegative = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

// Webview state survives upgrades; translate the old grid's saved layout and
// filters at hydration, so no downstream code needs the removed dependency.
export function normalizeDataframeState(value: unknown): DataframeState {
  if (!isRecord(value)) return { ...emptyDataframeState };
  const sorting: SortingState = [];
  const sort = isRecord(value.sort) ? value.sort.sortModel : undefined;
  const rawSorting: unknown[] = Array.isArray(value.sorting)
    ? value.sorting
    : Array.isArray(sort)
      ? sort
      : [];
  for (const item of rawSorting) {
    if (!isRecord(item)) continue;
    if (typeof item.id === "string" && typeof item.desc === "boolean")
      sorting.push({ id: item.id, desc: item.desc });
    else if (
      typeof item.colId === "string" &&
      (item.sort === "asc" || item.sort === "desc")
    )
      sorting.push({ id: item.colId, desc: item.sort === "desc" });
  }
  const columnSizing: ColumnSizingState = {};
  if (isRecord(value.columnSizing)) {
    for (const [id, size] of Object.entries(value.columnSizing)) {
      if (typeof size === "number" && Number.isFinite(size) && size > 0)
        columnSizing[id] = size;
    }
    const sizes: unknown[] = Array.isArray(value.columnSizing.columnSizingModel)
      ? value.columnSizing.columnSizingModel
      : [];
    for (const item of sizes) {
      if (
        isRecord(item) &&
        typeof item.colId === "string" &&
        typeof item.width === "number" &&
        Number.isFinite(item.width) &&
        item.width > 0
      )
        columnSizing[item.colId] = item.width;
    }
  }
  const columnFilters: Record<string, ColumnFilter> = {};
  if (isRecord(value.columnFilters)) {
    for (const [id, filter] of Object.entries(value.columnFilters)) {
      if (isColumnFilter(filter)) columnFilters[id] = filter;
    }
  } else if (isRecord(value.filter) && isRecord(value.filter.filterModel)) {
    for (const [id, raw] of Object.entries(value.filter.filterModel)) {
      const filter = legacyFilter(id, raw);
      if (filter) columnFilters[id] = filter;
    }
  }
  return {
    sorting,
    columnSizing,
    columnFilters,
    columnPinning: isRecord(value.columnPinning)
      ? {
          start: strings(
            value.columnPinning.start ??
              value.columnPinning.left ??
              value.columnPinning.leftColIds
          ),
          end: strings(
            value.columnPinning.end ??
              value.columnPinning.right ??
              value.columnPinning.rightColIds
          ),
        }
      : { start: [], end: [] },
    columnOrder: strings(
      isRecord(value.columnOrder)
        ? value.columnOrder.orderedColIds
        : value.columnOrder
    ),
    scroll: isRecord(value.scroll)
      ? {
          top: nonnegative(value.scroll.top),
          left: nonnegative(value.scroll.left),
        }
      : { top: 0, left: 0 },
  };
}

export function normalizeDataframeStates(
  value: unknown
): Record<string, DataframeState> {
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).map(([id, state]) => [
          id,
          normalizeDataframeState(state),
        ])
      )
    : {};
}
