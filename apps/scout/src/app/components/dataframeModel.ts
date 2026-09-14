import type {
  ColumnFilter,
  FilterCondition,
  FilterType,
  UiOperator,
} from "@tsmono/inspect-components/columnFilter";
import { centerTruncate } from "@tsmono/util";

import { valueAsString } from "../utils/format";

export type DataframeRow = Record<string, unknown>;

export function dataframePinOffsets(
  columns: { id: string; size: number }[],
  pinning: { left: string[]; right: string[] },
  rowNumberWidth: number
): Record<string, { left?: number; right?: number }> {
  const offsets: Record<string, { left?: number; right?: number }> = {};
  let left = rowNumberWidth;
  let right = 0;
  for (const column of columns) {
    if (pinning.left.includes(column.id)) {
      offsets[column.id] = { left };
      left += column.size;
    }
  }
  for (const column of [...columns].reverse()) {
    if (pinning.right.includes(column.id)) {
      offsets[column.id] = { right };
      right += column.size;
    }
  }
  return offsets;
}

function rawText(value: unknown): string {
  if (value instanceof Date) return value.toString();
  if (Array.isArray(value))
    return value.map((item) => (item == null ? "" : rawText(item))).join(",");
  if (value !== null && typeof value === "object") return "[object Object]";
  return String(value);
}

export function formatDataframeValue(
  value: unknown,
  options?: { maxStrLen?: number }
): string {
  if (!options) return value == null ? "" : rawText(value);
  return typeof value === "string"
    ? centerTruncate(value, options.maxStrLen)
    : valueAsString(value);
}

export function dataframeFilterType(
  rows: DataframeRow[],
  column: string
): FilterType {
  const value = rows.find((row) => row[column] != null)?.[column];
  return typeof value === "number"
    ? "number"
    : value instanceof Date ||
        (typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
          Number.isFinite(Date.parse(value)))
      ? "date"
      : "string";
}

export const dataframeOperators = (type: FilterType): UiOperator[] =>
  type === "string"
    ? [
        "contains",
        "does not contain",
        "=",
        "!=",
        "starts with",
        "ends with",
        "is blank",
        "is not blank",
      ]
    : ["=", "!=", ">", ">=", "<", "<=", "between", "is blank", "is not blank"];

function matchesCondition(
  value: unknown,
  type: FilterType,
  condition: FilterCondition
): boolean {
  const blank =
    value == null || (typeof value === "string" && value.trim() === "");
  const { operator, value: input, value2 } = condition;
  if (operator === "is blank") return blank;
  if (operator === "is not blank") return !blank;
  // Text negatives include blanks; numeric/date comparisons exclude them.
  if (value == null)
    return (
      type === "string" &&
      (operator === "!=" || operator === "does not contain")
    );
  const actual =
    type === "number"
      ? Number(value)
      : type === "date"
        ? dateValue(value)
        : valueAsString(value).toLowerCase();
  const expected =
    type === "number"
      ? Number(input)
      : type === "date"
        ? dateValue(input)
        : input.toLowerCase();
  const end =
    type === "number"
      ? Number(value2)
      : type === "date"
        ? dateValue(value2)
        : (value2 ?? "").toLowerCase();
  switch (operator) {
    case "=":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    case "between":
      // The previous grid's default range filter excludes its endpoints.
      return actual > expected && actual < end;
    case "not between":
      return actual < expected || actual > end;
    case "contains":
      return String(actual).includes(String(expected));
    case "does not contain":
      return !String(actual).includes(String(expected));
    case "starts with":
      return String(actual).startsWith(String(expected));
    case "ends with":
      return String(actual).endsWith(String(expected));
    case "in":
    case "not in":
      return false;
  }
}

function dateValue(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const text = typeof value === "string" ? value : "";
  // A date input is local midnight; a timestamp keeps its time and timezone.
  return new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text
  ).getTime();
}

export function matchesDataframeFilter(
  value: unknown,
  filter: ColumnFilter
): boolean {
  const first = matchesCondition(value, filter.filterType, filter.spec);
  if (!filter.spec.second) return first;
  const second = matchesCondition(value, filter.filterType, filter.spec.second);
  return filter.spec.join === "or" ? first || second : first && second;
}

export function compareDataframeValues(a: unknown, b: unknown): number {
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  const left =
    a instanceof Date
      ? a.getTime()
      : typeof a === "number" || typeof a === "boolean"
        ? Number(a)
        : valueAsString(a);
  const right =
    b instanceof Date
      ? b.getTime()
      : typeof b === "number" || typeof b === "boolean"
        ? Number(b)
        : valueAsString(b);
  return left > right ? 1 : left < right ? -1 : 0;
}

// Match the previous export contract: displayed values (including truncation),
// selected column order, all filtered/sorted rows, quoted fields and CRLF.
export function dataframeCsv(
  rows: DataframeRow[],
  columns: string[],
  options?: { maxStrLen?: number }
): string {
  if (columns.length === 0) return "";
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    columns.map(quote).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => quote(formatDataframeValue(row[column], options)))
        .join(",")
    ),
  ].join("\r\n");
}

export function downloadDataframeCsv(csv: string, fileName: string): void {
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/plain;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
