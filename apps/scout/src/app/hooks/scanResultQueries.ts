import { queryOptions, skipToken } from "@tanstack/react-query";
import { ColumnTable } from "arquero";

import { ScanResultData, ScanResultSummary } from "../types";
import { withParams } from "../utils/arrowCells";
import {
  parseScanResultData,
  parseScanResultSummaries,
} from "../utils/arrowHelpers";

/**
 * Parsing a scan dataframe into view models is async (JSON cells decode off
 * the main thread) and pure in the table, so it runs as a react-query
 * derivation: one parse per table however many hooks observe it, cancelled
 * and cached by the same machinery as the fetch that produced the table.
 */

// A ColumnTable can't be serialized into a query key, so each table object
// is assigned a stable id for the life of that object.
const tableIds = new WeakMap<ColumnTable, number>();
let nextTableId = 0;

const tableKey = (table: ColumnTable): number => {
  let id = tableIds.get(table);
  if (id === undefined) {
    id = nextTableId++;
    tableIds.set(table, id);
  }
  return id;
};

const kSkipped = [skipToken] as const;

// Derivations never fail transiently; a parse error is a data problem.
const kDerivation = { staleTime: Infinity, retry: false } as const;

export const scanResultSummariesQuery = (
  columnTable: ColumnTable | undefined
) =>
  queryOptions({
    queryKey: columnTable
      ? (["scanResultSummaries", tableKey(columnTable)] as const)
      : kSkipped,
    queryFn: columnTable
      ? (): Promise<ScanResultSummary[]> =>
          parseScanResultSummaries(columnTable.objects())
      : skipToken,
    ...kDerivation,
  });

const filterScanResultRow = (
  columnTable: ColumnTable,
  rowIdentifier: string
): ColumnTable | undefined => {
  if (columnTable.columnNames().length === 0) {
    return undefined;
  }
  const filtered = withParams(columnTable, {
    targetIdentifier: rowIdentifier,
  }).filter(
    (d: { identifier: string }, $: { targetIdentifier: string }) =>
      d.identifier === $.targetIdentifier
  );
  return filtered.numRows() === 0 ? undefined : filtered;
};

// `null` is the query's honest answer for "no such row" (react-query treats
// undefined data as a failed queryFn).
export const scanResultDataQuery = (
  columnTable: ColumnTable | undefined,
  rowIdentifier: string | undefined
) => {
  const input =
    columnTable && rowIdentifier ? { columnTable, rowIdentifier } : undefined;
  return queryOptions({
    queryKey: input
      ? ([
          "scanResultData",
          tableKey(input.columnTable),
          input.rowIdentifier,
        ] as const)
      : kSkipped,
    queryFn: input
      ? async (): Promise<ScanResultData | null> => {
          const filtered = filterScanResultRow(
            input.columnTable,
            input.rowIdentifier
          );
          return filtered ? await parseScanResultData(filtered) : null;
        }
      : skipToken,
    ...kDerivation,
  });
};
