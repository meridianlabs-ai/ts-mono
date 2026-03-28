import { useCallback, useEffect } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

// When a defaultValue is provided, the returned value is guaranteed non-undefined.
export function useProperty<T>(
  id: string,
  propertyName: string,
  options: { defaultValue: T; cleanup?: boolean }
): [T, (value: T) => void, () => void];

// Without a defaultValue the returned value may be undefined.
export function useProperty<T>(
  id: string,
  propertyName: string,
  options?: { defaultValue?: T; cleanup?: boolean }
): [T | undefined, (value: T) => void, () => void];

export function useProperty<T>(
  id: string,
  propertyName: string,
  options?: {
    defaultValue?: T;
    cleanup?: boolean;
  }
): [T | undefined, (value: T) => void, () => void] {
  const { usePropertyValue, useSetPropertyValue, useRemovePropertyValue } =
    useComponentStateHooks();

  const defaultValue = options?.defaultValue;
  const cleanup = options?.cleanup ?? true;

  const propertyValue = usePropertyValue(id, propertyName, defaultValue) as
    | T
    | undefined;

  const setPropertyValueFn = useSetPropertyValue();
  const removePropertyValueFn = useRemovePropertyValue();

  const setValue = useCallback(
    (value: T) => {
      setPropertyValueFn(id, propertyName, value);
    },
    [id, propertyName, setPropertyValueFn]
  );

  const removeValue = useCallback(() => {
    removePropertyValueFn(id, propertyName);
  }, [id, propertyName, removePropertyValueFn]);

  useEffect(() => {
    return () => {
      if (cleanup) {
        removePropertyValueFn(id, propertyName);
      }
    };
  }, [id, propertyName, removePropertyValueFn, cleanup]);

  return [propertyValue, setValue, removeValue];
}
