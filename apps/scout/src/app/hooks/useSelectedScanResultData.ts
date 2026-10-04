import { useQuery } from "@tanstack/react-query";
import { ColumnTable } from "arquero";

import { AsyncData, data, loading } from "@tsmono/util";

import { ScanResultData } from "../types";

import { scanResultDataQuery } from "./scanResultQueries";
import { useSelectedScanDataframe } from "./useSelectedScanDataframe";

export const useSelectedScanResultData = (
  scanResultUuid: string | undefined
): AsyncData<ScanResultData | undefined> => {
  const { data: columnTable } = useSelectedScanDataframe();
  return useScanResultData(columnTable, scanResultUuid);
};

const useScanResultData = (
  // TODO: We need `| undefined` both on the input param as well as on the output
  // in order to honor the rules of hooks when the caller doesn't YET have the uuid.
  // Better would be to refactor the parent so that it doesn't even render until
  // it has the params so that it can avoid the hook call altogether.
  columnTable: ColumnTable | undefined,
  rowIdentifier: string | undefined
): AsyncData<ScanResultData | undefined> => {
  const query = useQuery(scanResultDataQuery(columnTable, rowIdentifier));
  if (!columnTable || !rowIdentifier) {
    return data(undefined);
  }
  if (query.isPending) {
    return loading;
  }
  if (query.isError) {
    return { loading: false, error: query.error };
  }
  return data(query.data ?? undefined);
};
