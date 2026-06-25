/**
 * Checks if a given value is numeric.
 */
export const isNumeric = (n: unknown): boolean => {
  return !isNaN(parseFloat(n as any)) && isFinite(n as any);
};

/**
 * Ensures the value is an array
 *
 * @param {*} val - The value to ensure is an array.
 * @returns {Array} - an Array
 */
export const toArray = <T>(val: T | T[]): Array<T> => {
  if (Array.isArray(val)) {
    return val;
  } else {
    return [val];
  }
};

/**
 * Checks if a given value is a Record.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const defined = <T>(value: T | undefined): T => {
  if (value === undefined) {
    // Conservative noUncheckedIndexedAccess bridge: preserve the old throwy path until callers can be refactored to prove the invariant locally.
    throw new Error("Expected value to be defined");
  }
  return value;
};
