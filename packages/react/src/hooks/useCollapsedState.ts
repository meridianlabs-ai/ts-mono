import { useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsedState = (
  id: string,
  defaultValue?: boolean,
  scope?: string
): [boolean, (value: boolean) => void] => {
  const { useBucketValue, useSetBucketValue } = useComponentStateHooks();

  const resolvedScope = scope || "collapse-state-scope";
  const collapsed = useBucketValue(resolvedScope, id);
  const setBucketValueFn = useSetBucketValue();

  return useMemo(() => {
    const set = (value: boolean) => {
      setBucketValueFn(resolvedScope, id, value);
    };
    return [collapsed ?? defaultValue ?? false, set];
  }, [collapsed, resolvedScope, defaultValue, setBucketValueFn, id]);
};
