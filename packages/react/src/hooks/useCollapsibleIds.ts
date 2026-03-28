import { useCallback, useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsibleIds = (
  key: string
): [
  Record<string, boolean>,
  (id: string, value: boolean) => void,
  () => void,
] => {
  const {
    useCollapsedIds: useCollapsedIdsPrimitive,
    useCollapseId,
    useClearCollapsedIds,
  } = useComponentStateHooks();

  const collapsedIds = useCollapsedIdsPrimitive(key);

  const collapseIdFn = useCollapseId();
  const collapseId = useCallback(
    (id: string, value: boolean) => {
      collapseIdFn(key, id, value);
    },
    [key, collapseIdFn]
  );

  const clearCollapsedIdsFn = useClearCollapsedIds();
  const clearIds = useCallback(() => {
    clearCollapsedIdsFn(key);
  }, [clearCollapsedIdsFn, key]);

  return useMemo(() => {
    return [collapsedIds || {}, collapseId, clearIds];
  }, [collapsedIds, collapseId, clearIds]);
};
