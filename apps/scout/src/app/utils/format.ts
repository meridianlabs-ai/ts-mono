/**
 * Stringifies a value for display or sorting, JSON-encoding objects and arrays
 * so they don't collapse to "[object Object]". Non-objects (including null and
 * undefined) match `String()` semantics.
 */
export function valueAsString(value: unknown): string {
  return value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
}
