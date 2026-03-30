import { useCallback, useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsibleIds = (
  key: string
): [
  Record<string, boolean>,
  (id: string, value: boolean) => void,
  () => void,
] => {
  const { usePropertyEntries, useSetPropertyValue, useRemoveAllProperties } =
    useComponentStateHooks();

  const entries = usePropertyEntries(key);

  const setPropertyValueFn = useSetPropertyValue();
  const collapseId = useCallback(
    (id: string, value: boolean) => {
      setPropertyValueFn(key, id, value);
    },
    [key, setPropertyValueFn]
  );

  const removeAllFn = useRemoveAllProperties();
  const clearIds = useCallback(() => {
    removeAllFn(key);
  }, [removeAllFn, key]);

  return useMemo(() => {
    return [(entries || {}) as Record<string, boolean>, collapseId, clearIds];
  }, [entries, collapseId, clearIds]);
};
