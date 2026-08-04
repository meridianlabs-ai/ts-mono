import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import {
  databaseLogsListingKeyRoot,
  readLogsColumnFacts,
  scorerMapsEqual,
  type LogsColumnFacts,
} from "../../log_data";
import { useStableValue } from "../shared/useStableValue";

/** Row content gets a new identity on every detail flush while a directory
 *  syncs, but the facts almost never change — content equality keeps column
 *  defs (and everything keyed on the schema) referentially stable across
 *  flushes. */
const columnFactsEqual = (
  a: AsyncData<LogsColumnFacts>,
  b: AsyncData<LogsColumnFacts>
): boolean =>
  a.loading === b.loading &&
  a.error === b.error &&
  (a.data !== undefined && b.data !== undefined
    ? a.data.hasSampleLimits === b.data.hasSampleLimits &&
      scorerMapsEqual(a.data.scorerMap, b.data.scorerMap)
    : a.data === b.data);

/**
 * The whole-universe facts the column set is built from (see
 * `readLogsColumnFacts`) — a score column must exist even when the only log
 * carrying its scorer sits on an unloaded page, so this reads a data-layer
 * projection rather than any row list. Keyed under the listing root so the
 * write path's throttled invalidation refreshes it alongside the row
 * queries.
 */
export const useLogColumnFacts = (
  logDir: string,
  scopeDir?: string
): AsyncData<LogsColumnFacts> =>
  useStableValue(
    useAsyncDataFromQuery({
      queryKey: [
        ...databaseLogsListingKeyRoot,
        "column-facts",
        logDir,
        scopeDir ?? null,
      ],
      queryFn: () => readLogsColumnFacts(logDir, scopeDir),
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
    columnFactsEqual
  );
