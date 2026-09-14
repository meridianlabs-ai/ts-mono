import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

/** Notify an external consumer after mount and whenever a value changes. */
export function useValueChange<T>(
  value: T,
  onChange: (value: T) => void
): void {
  const onChangeRef = useLatestRef(onChange);
  useEffect(() => {
    onChangeRef.current(value);
  }, [value, onChangeRef]);
}
