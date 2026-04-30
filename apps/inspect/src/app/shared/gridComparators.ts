import type { IRowNode } from "ag-grid-community";

/**
 * Creates a comparator that ensures folders are always displayed first,
 * regardless of sort order, and then applies the provided comparison function
 * for non-folder items.
 *
 * @param compareFn - Function to compare two values (can use items if needed)
 * @returns A comparator function suitable for ag-grid ColDef
 */
export function createFolderFirstComparator<T extends { type?: string }>(
  compareFn: (valueA: unknown, valueB: unknown, itemA: T, itemB: T) => number
) {
  return (
    valueA: unknown,
    valueB: unknown,
    nodeA: IRowNode<T>,
    nodeB: IRowNode<T>
  ): number => {
    const itemA = nodeA.data;
    const itemB = nodeB.data;
    if (!itemA || !itemB) return 0;

    // Always put folders first
    if (itemA.type !== itemB.type) {
      return itemA.type === "folder" ? -1 : 1;
    }

    // Both are the same type, use the provided comparison function
    return compareFn(valueA, valueB, itemA, itemB);
  };
}

const isMissingNumber = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  v === "" ||
  (typeof v === "number" && Number.isNaN(v));

/**
 * Common comparison functions for use with createFolderFirstComparator
 */
export const comparators = {
  /**
   * Compare values as numbers. NaN / null / undefined / "" are pinned to the
   * bottom regardless of sort direction — the sentinel is flipped on
   * `isDescending` so ag-grid's reversal still leaves missing rows last.
   * A non-NaN-aware comparator returns 0 for any pair involving NaN, which
   * violates transitivity and scrambles the non-NaN rows too.
   */
  number: (
    a: unknown,
    b: unknown,
    _nodeA?: IRowNode,
    _nodeB?: IRowNode,
    isDescending?: boolean
  ): number => {
    const aMissing = isMissingNumber(a);
    const bMissing = isMissingNumber(b);
    if (aMissing && bMissing) return 0;
    if (aMissing) return isDescending ? -1 : 1;
    if (bMissing) return isDescending ? 1 : -1;
    return Number(a) - Number(b);
  },

  /** Compare values as dates */
  date: (a: unknown, b: unknown) => {
    const timeA = a ? new Date(a as string | number | Date).getTime() : 0;
    const timeB = b ? new Date(b as string | number | Date).getTime() : 0;
    return timeA - timeB;
  },
};
