import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";

import { DB_NAME } from "../client/database/schema";
import { OpenDatabase } from "../client/database/service";
import { queryClient } from "../state/queryClient";

import { FetchEngine } from "./fetchEngine";
import { createLogsContentSink, getLogRows, writeDetails } from "./logsContent";
import { testClientAPI, testLogDetails } from "./testFixtures";

const details = (name: string) =>
  testLogDetails({ status: "success", eval: testEvalSpec({ eval_id: name }) });

let db: OpenDatabase;
let engine: FetchEngine;

beforeEach(async () => {
  db = await OpenDatabase.open();
  engine = new FetchEngine({ flushDelayMs: 0, statsDelayMs: 0 });
});

afterEach(async () => {
  engine.stop();
  queryClient.clear();
  db.close();
  await Dexie.delete(DB_NAME);
});

describe("FetchEngine against the real sink", () => {
  test("a cache hit on one log does not drop the rest of the listing", async () => {
    const logDir = "/logs";
    const fileA = "/logs/a.eval";
    const fileB = "/logs/b.eval";
    await writeDetails(db, logDir, {
      [fileA]: details(fileA),
      [fileB]: details(fileB),
    });
    queryClient.clear();

    await engine.start({
      api: testClientAPI({
        get_log_details: () => Promise.resolve(details(fileA)),
      }),
      database: db,
      sink: createLogsContentSink(db, logDir),
      logDir,
    });

    expect(getLogRows(logDir).map((row) => row.name)).toEqual([fileA, fileB]);

    // A completed header is already persisted, so this resolves through the
    // cache-hit path rather than waiting for the background details refresh.
    await engine.ensure(fileA, { depth: "detailed", priority: "user" });

    expect(getLogRows(logDir).map((row) => row.name)).toEqual([fileA, fileB]);
  });
});
