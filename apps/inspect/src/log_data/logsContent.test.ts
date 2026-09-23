/**
 * Tests for the logsContent IndexedDB + cache seam (fake-indexeddb, like
 * database.test.ts).
 */
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";

import {
  testClientAPI,
  testLogDetails,
  testSampleSummary,
} from "../client/api/testClientApi";
import type { Log } from "../client/api/types";
import { DB_NAME } from "../client/database/schema";
import {
  createDatabaseService,
  DatabaseService,
} from "../client/database/service";
import { normalizeEvalHeader } from "../client/utils/normalize";
import { queryClient } from "../state/queryClient";

import { FetchEngine } from "./fetchEngine";
import {
  clearFile,
  createLogsContentSink,
  logKey,
  logsKey,
  mergeFetchStates,
  setListing,
  writeDetails,
  writeListing,
  writePreviews,
} from "./logsContent";

const invalidateListings = vi.hoisted(() => vi.fn());
vi.mock("./databaseListings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./databaseListings")>()),
  invalidateDatabaseLogsListings: invalidateListings,
}));

describe("writeListing", () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = createDatabaseService();
    await db.openDatabase();
  });

  afterEach(async () => {
    queryClient.clear();
    await db.closeDatabase();
    await Dexie.delete(DB_NAME);
  });

  test("persists and reads back rows in the dir's namespace", async () => {
    const rows = await writeListing(db, "file:///logs", [
      { name: "file:///logs/a.eval" },
    ]);

    expect(rows.map((row) => row.name)).toEqual(["file:///logs/a.eval"]);
    expect(await db.readLogs({ prefix: "file:///logs" })).toHaveLength(1);
    expect((await db.getSyncScope("file:///logs"))?.last_synced).toBeDefined();
  });

  test("degrades to cache-only when names are outside the dir's namespace", async () => {
    // An older view server: aliased-path log_dir, file:// URI names.
    const rows = await writeListing(db, "~/logs", [
      { name: "file:///home/me/logs/a.eval" },
    ]);

    // The listing still lands (cache) instead of being blanked by an empty
    // scoped read-back...
    expect(rows.map((row) => row.name)).toEqual([
      "file:///home/me/logs/a.eval",
    ]);
    // ...and nothing was persisted where no scoped read could reach it.
    expect(await db.readLogs({ prefix: "~/logs" })).toHaveLength(0);
    expect(await db.getSyncScope("~/logs")).toBeUndefined();
  });
});

describe("writeDetails", () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = createDatabaseService();
    await db.openDatabase();
  });

  afterEach(async () => {
    queryClient.clear();
    await db.closeDatabase();
    await Dexie.delete(DB_NAME);
    vi.restoreAllMocks();
  });

  test("a payload whose derivation throws is skipped and reported without taking the rest of the batch with it", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    // Wire data the normalizers pass through but derivation rejects: the
    // spec normalizer does not validate model_roles, and modelRoleNames
    // dereferences each role's config.
    const poisoned = normalizeEvalHeader({
      eval: { ...testEvalSpec(), model_roles: { grader: null } },
    });

    const failures = await writeDetails(db, "file:///logs", {
      "file:///logs/bad.eval": testLogDetails(poisoned),
      "file:///logs/good.eval": testLogDetails({
        sampleSummaries: [testSampleSummary({ id: "s1" })],
      }),
    });

    const rows = await db.readLogs({ prefix: "file:///logs" });
    expect(rows?.map((row) => [row.name, row.depth])).toEqual([
      ["file:///logs/good.eval", "detailed"],
    ]);
    expect(
      await db.readSampleSummaries({ file: "file:///logs/good.eval" })
    ).toHaveLength(1);
    expect(Object.keys(failures)).toEqual(["file:///logs/bad.eval"]);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe("db-less write invalidation", () => {
  // Listing queries in db-less sessions read from the react-query cache and
  // only refetch on invalidation — so every cache-updating write must fire
  // it, not just the persisted ones.
  beforeEach(() => {
    invalidateListings.mockClear();
  });

  afterEach(() => {
    queryClient.clear();
  });

  test("a db-less preview merge refreshes the listings", async () => {
    await writePreviews(null, "/plain/logs", {});
    expect(invalidateListings).toHaveBeenCalled();
  });

  test("a db-less file clear refreshes the listings", async () => {
    await clearFile(null, "/plain/logs", "/plain/logs/a.eval");
    expect(invalidateListings).toHaveBeenCalled();
  });
});

describe("mergeFetchStates", () => {
  const fetchState = {
    preview_attempts: 2,
    details_attempts: 0,
    details_settled_seq: 0,
  };

  afterEach(() => {
    queryClient.clear();
  });

  test("fills an observed entry with null data from the listing row", () => {
    const key = logKey("/logs", "/logs/a.eval");
    setListing("/logs", [{ name: "/logs/a.eval", mtime: 1 }]);
    // Observed, but the entity has no data of its own yet.
    queryClient.setQueryData(key, null);

    mergeFetchStates("/logs", { "/logs/a.eval": fetchState });

    expect(queryClient.getQueryData(key)).toMatchObject({
      name: "/logs/a.eval",
      mtime: 1,
      preview_attempts: 2,
    });
  });

  test("merges into an observed entry that already has data", () => {
    const key = logKey("/logs", "/logs/a.eval");
    queryClient.setQueryData(key, null);
    setListing("/logs", [{ name: "/logs/a.eval", mtime: 1 }]);

    mergeFetchStates("/logs", { "/logs/a.eval": fetchState });

    expect(queryClient.getQueryData(key)).toMatchObject({
      name: "/logs/a.eval",
      mtime: 1,
      preview_attempts: 2,
    });
  });

  test("never materializes an entry for an unobserved log", () => {
    const key = logKey("/logs", "/logs/a.eval");
    setListing("/logs", [{ name: "/logs/a.eval", mtime: 1 }]);

    mergeFetchStates("/logs", { "/logs/a.eval": fetchState });

    expect(queryClient.getQueryState(key)).toBeUndefined();
  });
});

describe("sink mergeRows", () => {
  const row = (name: string, status: Log["status"]): Log => ({
    name,
    depth: "previewed",
    status,
    preview_attempts: 0,
    details_attempts: 0,
    details_settled_seq: 0,
  });

  afterEach(() => {
    queryClient.clear();
  });

  test("upserts rows by name without dropping the rest of the listing", () => {
    const sink = createLogsContentSink(null, "/logs");
    sink.seedRows([
      row("/logs/a.eval", "success"),
      row("/logs/b.eval", "started"),
      row("/logs/c.eval", "success"),
    ]);

    sink.mergeRows([
      row("/logs/b.eval", "error"),
      row("/logs/d.eval", "success"),
    ]);

    expect(
      queryClient
        .getQueryData<Log[]>(logsKey("/logs"))
        ?.map((r) => [r.name, r.status])
    ).toEqual([
      ["/logs/a.eval", "success"],
      ["/logs/b.eval", "error"],
      ["/logs/c.eval", "success"],
      ["/logs/d.eval", "success"],
    ]);
  });
});

describe("opening a cached log", () => {
  const dir = "file:///logs";
  const opened = `${dir}/a.eval`;
  const limited = `${dir}/b.eval`;
  let db: DatabaseService;
  let engine: FetchEngine;

  beforeEach(async () => {
    db = createDatabaseService();
    await db.openDatabase();
    await writeListing(db, dir, [{ name: opened }, { name: limited }]);
    await writeDetails(db, dir, {
      [opened]: testLogDetails(),
      [limited]: testLogDetails({
        sampleSummaries: [testSampleSummary({ id: "s1", limit: "token" })],
      }),
    });
    queryClient.clear();
    engine = new FetchEngine({ flushDelayMs: 0, statsDelayMs: 0 });
    await engine.start({
      api: testClientAPI(),
      database: db,
      sink: createLogsContentSink(db, dir),
      logDir: dir,
    });
  });

  afterEach(async () => {
    engine.stop();
    queryClient.clear();
    await db.closeDatabase();
    await Dexie.delete(DB_NAME);
  });

  test("keeps the rest of the listing (and its header facts) in the cache", async () => {
    await engine.ensure(opened, {
      depth: "detailed",
      priority: "user",
      demand: "passive",
    });

    expect(
      queryClient
        .getQueryData<Log[]>(logsKey(dir))
        ?.map((row) => [row.name, row.header?.sampleLimits])
    ).toEqual([
      [opened, []],
      [limited, ["token"]],
    ]);
  });
});
