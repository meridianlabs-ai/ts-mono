import { useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsedState = (
  id: string,
  defaultValue?: boolean,
  scope?: string
): [boolean, (value: boolean) => void] => {
  const { useCollapsedValue, useSetCollapsed } = useComponentStateHooks();

  const resolvedScope = scope || "collapse-state-scope";
  const collapsed = useCollapsedValue(id, resolvedScope);
  const setCollapsedFn = useSetCollapsed();

  return useMemo(() => {
    const set = (value: boolean) => {
      setCollapsedFn(resolvedScope, id, value);
    };
    return [collapsed ?? defaultValue ?? false, set];
  }, [collapsed, resolvedScope, defaultValue, setCollapsedFn, id]);
};
