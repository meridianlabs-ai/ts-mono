import { useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsedState = (
  id: string,
  defaultValue?: boolean,
  scope?: string
): [boolean, (value: boolean) => void] => {
  const { usePropertyValue, useSetPropertyValue } = useComponentStateHooks();

  const resolvedScope = scope || "collapse-state-scope";
  const collapsed = usePropertyValue(resolvedScope, id) as boolean | undefined;
  const setPropertyValueFn = useSetPropertyValue();

  return useMemo(() => {
    const set = (value: boolean) => {
      setPropertyValueFn(resolvedScope, id, value);
    };
    return [collapsed ?? defaultValue ?? false, set];
  }, [collapsed, resolvedScope, defaultValue, setPropertyValueFn, id]);
};
