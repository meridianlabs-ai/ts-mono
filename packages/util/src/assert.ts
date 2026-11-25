/**
 * Returns `value`, throwing if it is `undefined`. For an index or key the
 * surrounding logic guarantees (a binary search within bounds, a key set a
 * few lines up) where restructuring can't show that to the type checker.
 * A broken invariant then fails here, naming `what`, instead of passing
 * `undefined` on.
 */
export const expectDefined = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`Expected ${what}`);
  return value;
};
