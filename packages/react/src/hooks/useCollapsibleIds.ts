import { useCallback, useMemo } from "react";

import { useComponentStateHooks } from "../state/ComponentStateContext";

export const useCollapsibleIds = (
  key: string
): [
  Record<string, boolean>,
  (id: string, value: boolean) => void,
  () => void,
] => {
  const { useBucketEntries, useSetBucketValue, useClearBucket } =
    useComponentStateHooks();

  const bucketEntries = useBucketEntries(key);

  const setBucketValueFn = useSetBucketValue();
  const collapseId = useCallback(
    (id: string, value: boolean) => {
      setBucketValueFn(key, id, value);
    },
    [key, setBucketValueFn]
  );

  const clearBucketFn = useClearBucket();
  const clearIds = useCallback(() => {
    clearBucketFn(key);
  }, [clearBucketFn, key]);

  return useMemo(() => {
    return [bucketEntries || {}, collapseId, clearIds];
  }, [bucketEntries, collapseId, clearIds]);
};
