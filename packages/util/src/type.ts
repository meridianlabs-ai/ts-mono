/**
 * Checks if a given value is numeric.
 */
export const isNumeric = (n: unknown): boolean => {
  return !isNaN(parseFloat(String(n))) && isFinite(Number(n));
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
 * Narrows a `T | ReadonlyArray<T>` union, which `Array.isArray` cannot do on
 * its own — its signature only knows about mutable arrays. Unsound if `T` is
 * itself an array type.
 */
export const isReadonlyArray = <T>(
  value: T | ReadonlyArray<T>
): value is ReadonlyArray<T> => Array.isArray(value);

/**
 * Checks if a given value is a Record.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
