import { useEffect, useState } from "react";

/**
 * Returns `value` once it has stayed unchanged for `delayMs`. Until then it
 * returns the previous settled value, starting with the first render's value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}
