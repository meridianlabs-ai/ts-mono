import { useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsedState = (
  id: string,
  defaultValue?: boolean,
  scope?: string
): [boolean, (value: boolean) => void] => {
  const { useValue, useSetValue } = useComponentStateHooks();

  const resolvedScope = scope || "collapse-state-scope";
  const stored = useValue(resolvedScope, id);
  const collapsed = typeof stored === "boolean" ? stored : undefined;
  const setPropertyValueFn = useSetValue();

  return useMemo(() => {
    const set = (value: boolean) => {
      setPropertyValueFn(resolvedScope, id, value);
    };
    return [collapsed ?? defaultValue ?? false, set];
  }, [collapsed, resolvedScope, defaultValue, setPropertyValueFn, id]);
};
