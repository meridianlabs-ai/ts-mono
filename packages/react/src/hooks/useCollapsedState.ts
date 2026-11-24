/* eslint-disable react-hooks/hooks -- each host app injects its store hooks through ComponentStateContext, so they arrive as values; the compiler skips this hook until that context hands out a store API instead */
import { useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsedState = (
  id: string,
  defaultValue?: boolean,
  scope?: string
): [boolean, (value: boolean) => void] => {
  // Opted out of the compiler; the react-hooks/hooks disable in this file says why.
  "use no memo";
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
