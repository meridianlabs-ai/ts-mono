import { useCallback, useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsibleIds = (
  key: string
): [
  Record<string, boolean> | undefined,
  (id: string, value: boolean) => void,
  () => void,
] => {
  const { useEntries, useSetValue, useRemoveAll } = useComponentStateHooks();

  const entries = useEntries(key);

  const setPropertyValueFn = useSetValue();
  const collapseId = useCallback(
    (id: string, value: boolean) => {
      setPropertyValueFn(key, id, value);
    },
    [key, setPropertyValueFn]
  );

  const removeAllFn = useRemoveAll();
  const clearIds = useCallback(() => {
    removeAllFn(key);
  }, [removeAllFn, key]);

  return useMemo(() => {
    // The store's entries are unknown-valued; keep the booleans this hook
    // promises rather than claiming every entry is one.
    const collapsed =
      entries &&
      Object.fromEntries(
        Object.entries(entries).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
        )
      );
    return [collapsed, collapseId, clearIds];
  }, [entries, collapseId, clearIds]);
};
