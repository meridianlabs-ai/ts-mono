import { valueAsString } from "@tsmono/util";

/** A cell's tooltip: its full value, which a truncated cell may cut off. */
export function cellTitle(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return valueAsString(value);
}
