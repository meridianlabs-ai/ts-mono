const isMissingNumber = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  v === "" ||
  (typeof v === "number" && Number.isNaN(v));

/**
 * Common value-comparison functions for client-side grid sorting.
 */
// Grid cells hold unknown values; a date column's are strings, epoch numbers,
// or Dates, and anything else sorts as epoch 0 the way a falsy value did.
const toTime = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
};

export const comparators = {
  /**
   * Compare values as numbers. NaN / null / undefined / "" are pinned to the
   * bottom regardless of sort direction — the sentinel is flipped on
   * `isDescending` so the caller's reversal still leaves missing rows last.
   * A non-NaN-aware comparator returns 0 for any pair involving NaN, which
   * violates transitivity and scrambles the non-NaN rows too.
   */
  number: (a: unknown, b: unknown, isDescending?: boolean): number => {
    const aMissing = isMissingNumber(a);
    const bMissing = isMissingNumber(b);
    if (aMissing && bMissing) return 0;
    if (aMissing) return isDescending ? -1 : 1;
    if (bMissing) return isDescending ? 1 : -1;
    return Number(a) - Number(b);
  },

  /** Compare values as dates */
  date: (a: unknown, b: unknown): number => toTime(a) - toTime(b),
};
