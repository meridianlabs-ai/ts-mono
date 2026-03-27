import { skipToken } from "@tanstack/react-query";
import { ColumnTable } from "arquero";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData, decodeArrowBytes } from "@tsmono/util";

import { useApi } from "../../state/store";
import { expandResultsetRows } from "../utils/arrow";

type ScanDataframeParams = {
  scansDir: string;
  scanPath: string;
  scanner: string;
};

// Fetches scanner dataframe from the server by location and scanner.
// When isComplete is true, drops the "scans-inv" topic invalidation key
// so completed scan data is cached permanently without refetching.
export const useScanDataframe = (
  params: ScanDataframeParams | typeof skipToken,
  isComplete?: boolean
): AsyncData<ColumnTable> => {
  const api = useApi();

  // Include "scans-inv" by default so topic changes trigger refetches.
  // Only drop it once we know the scan is complete (immutable data).
  const invKey = isComplete === true ? undefined : "scans-inv";

  return useAsyncDataFromQuery({
    queryKey:
      params === skipToken
        ? [skipToken]
        : [
            "scanDataframe",
            params.scansDir,
            params.scanPath,
            params.scanner,
            ...(invKey ? [invKey] : []),
          ],
    queryFn:
      params === skipToken
        ? skipToken
        : async () =>
            expandResultsetRows(
              decodeArrowBytes(
                await api.getScannerDataframe(
                  params.scansDir,
                  params.scanPath,
                  params.scanner
                )
              )
            ),
    staleTime: Infinity,
  });
};
