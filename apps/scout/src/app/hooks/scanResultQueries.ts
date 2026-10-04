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

// Derivations never fail transiently, so a parse error is a data problem and
// is not retried. Entries drop as soon as their last observer leaves
// (gcTime 0): each queryFn closes over its ColumnTable, so a cached entry
// would otherwise pin superseded tables for the default five minutes while a
// running scan refetches the dataframe on every tick. Concurrent observers
// still share one parse.
const kDerivation = { staleTime: Infinity, retry: false, gcTime: 0 } as const;

// Callers get the error through the query, but nothing renders it today, so
// keep the diagnostic the effect-based hooks used to log.
const logged = async <T>(what: string, parse: Promise<T>): Promise<T> => {
  try {
    return await parse;
  } catch (error) {
    console.error(`Error parsing ${what}:`, error);
    throw error;
  }
};

export const scanResultSummariesQuery = (
  columnTable: ColumnTable | undefined
) =>
  queryOptions({
    queryKey: columnTable
      ? (["scanResultSummaries", tableKey(columnTable)] as const)
      : kSkipped,
    queryFn: columnTable
      ? (): Promise<ScanResultSummary[]> =>
          logged(
            "scan result summaries",
            parseScanResultSummaries(columnTable.objects())
          )
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
          return filtered
            ? await logged("scan result", parseScanResultData(filtered))
            : null;
        }
      : skipToken,
    ...kDerivation,
  });
};
