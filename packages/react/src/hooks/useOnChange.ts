import { useEffect, useRef } from "react";

import { useLatestRef } from "./useLatestRef";

/**
 * Runs `onChange` after a commit in which `value` differs (by `Object.is`)
 * from the previous commit's; not on mount. Always calls the latest
 * `onChange`, so it can close over current state without dependency plumbing.
 */
export function useOnChange<T>(
  value: T,
  onChange: (value: T, previous: T) => void
): void {
  const onChangeRef = useLatestRef(onChange);
  const previousRef = useRef(value);
  useEffect(() => {
    const previous = previousRef.current;
    if (Object.is(previous, value)) return;
    previousRef.current = value;
    onChangeRef.current(value, previous);
  }, [value, onChangeRef]);
}
