import { dateCompare, isMissingNumber } from "../../log_data";

/**
 * Common value-comparison functions for client-side grid sorting. The
 * primitives are the data layer's (`logColumnSchema.ts`), so grid sorts
 * can't drift from how listing queries compare the same columns; only
 * `number`'s missing-value placement differs, deliberately (see below).
 */
export const comparators = {
  /**
   * Compare values as numbers. NaN / null / undefined / "" are pinned to the
   * bottom regardless of sort direction — the sentinel is flipped on
   * `isDescending` so the caller's reversal still leaves missing rows last.
   * A non-NaN-aware comparator returns 0 for any pair involving NaN, which
   * violates transitivity and scrambles the non-NaN rows too. This is NOT
   * the schema's `numberCompare`, which sorts missing as smallest and lets
   * the listing query negate for DESC (see `ValueComparator`'s doc).
   */
  number: (a: unknown, b: unknown, isDescending?: boolean): number => {
    const aMissing = isMissingNumber(a);
    const bMissing = isMissingNumber(b);
    if (aMissing && bMissing) return 0;
    if (aMissing) return isDescending ? -1 : 1;
    if (bMissing) return isDescending ? 1 : -1;
    return Number(a) - Number(b);
  },

  /** Compare values as dates. */
  date: dateCompare,
};
