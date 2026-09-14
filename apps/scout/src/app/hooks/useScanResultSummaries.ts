import { useQuery } from "@tanstack/react-query";
import { ColumnTable } from "arquero";

import { ScanResultSummary } from "../types";

import { scanResultSummariesQuery } from "./scanResultQueries";

const kNoSummaries: ScanResultSummary[] = [];

export const useScanResultSummaries = (
  columnTable?: ColumnTable
): { data: ScanResultSummary[]; isLoading: boolean; error: Error | null } => {
  // An absent or empty table has nothing to parse; answer without a query
  // round so callers can tell "no results" from "still parsing".
  const table =
    columnTable && columnTable.numRows() > 0 ? columnTable : undefined;
  const query = useQuery(scanResultSummariesQuery(table));
  if (!table) {
    return { data: kNoSummaries, isLoading: false, error: null };
  }
  return {
    data: query.data ?? kNoSummaries,
    isLoading: query.isPending,
    error: query.error,
  };
};
