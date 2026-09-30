/**
 * FetchEngine wired to the real sink (createLogsContentSink), not the fake
 * from fetchEngine.test.ts — exercises the actual queryClient contract the
 * fake can't catch (e.g. replace-vs-merge on the row list).
 */
import { afterEach, describe, expect, test } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";

import { Log } from "../client/api/types";
import { DatabaseService } from "../client/database";
import { toLogHeader } from "../client/utils/type-utils";
import { queryClient } from "../state/queryClient";

import { FetchEngine } from "./fetchEngine";
import { createLogsContentSink, getLogRows } from "./logsContent";
import {
  testClientAPI,
  testDatabaseService,
  testLogDetails,
} from "./testFixtures";

const details = (name: string) =>
  testLogDetails({ eval: testEvalSpec({ eval_id: name }) });

// Must carry a `header` — beginFetch's cache-hit condition is
// `cached?.header !== undefined`; without one the row is never treated as a
// cache hit at all, and a regression here would pass vacuously.
const row = (name: string): Log => ({
  name,
  depth: "detailed",
  status: "success",
  header: toLogHeader(details(name)),
  preview_attempts: 0,
  details_attempts: 0,
  details_settled_seq: 0,
});

const createFakeDb = (initialRows: Log[]): DatabaseService => {
  const rows: Record<string, Log> = Object.fromEntries(
    initialRows.map((r) => [r.name, { ...r }])
  );
  return testDatabaseService({
    opened: () => true,
    readLogs: () => Promise.resolve(Object.values(rows).map((r) => ({ ...r }))),
    readLogRow: (file: string) =>
      Promise.resolve(rows[file] ? { ...rows[file] } : null),
  });
};

afterEach(() => {
  queryClient.clear();
});

describe("FetchEngine against the real sink", () => {
  test("a cache hit on one log does not drop the rest of the listing", async () => {
    const logDir = "dir/proof";
    const db = createFakeDb([row("a.eval"), row("b.eval")]);
    const sink = createLogsContentSink(db, logDir);
    const engine = new FetchEngine({ flushDelayMs: 0, statsDelayMs: 0 });

    await engine.start({
      api: testClientAPI({
        get_log_details: () => Promise.resolve(details("a.eval")),
      }),
      database: db,
      sink,
      logDir,
    });

    expect(getLogRows(logDir)).toHaveLength(2); // sanity: start() seeded both

    // beginFetch's cache-hit branch: readLogRow("a.eval") hits, header
    // defined, status !== "started" — resolves from cache, then refreshes
    // in the background (default active demand).
    await engine.ensure("a.eval", { depth: "detailed", priority: "user" });

    expect(getLogRows(logDir)).toHaveLength(2);
  });
});
