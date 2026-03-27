import { skipToken, useQueryClient } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import { Status } from "../../types/api-types";

type ScanParams = {
  scansDir: string;
  scanPath: string;
};

// Fetches scan status from the server by location.
// Once the scan is complete, drops the "scans-inv" topic invalidation key
// so that topic changes no longer trigger refetches of immutable data.
export const useScan = (
  params: ScanParams | typeof skipToken
): AsyncData<Status> => {
  const api = useApi();
  const queryClient = useQueryClient();

  let isComplete = false;
  if (params !== skipToken) {
    const baseKey = ["scan", params.scansDir, params.scanPath];
    const cached =
      queryClient.getQueryData<Status>([...baseKey, "scans-inv"]) ??
      queryClient.getQueryData<Status>(baseKey);
    isComplete = cached?.complete === true;
  }

  return useAsyncDataFromQuery({
    queryKey:
      params === skipToken
        ? [skipToken]
        : isComplete
          ? ["scan", params.scansDir, params.scanPath]
          : ["scan", params.scansDir, params.scanPath, "scans-inv"],
    queryFn:
      params === skipToken
        ? skipToken
        : () => api.getScan(params.scansDir, params.scanPath),
    staleTime: isComplete ? Infinity : 10000,
  });
};
