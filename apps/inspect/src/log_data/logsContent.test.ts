/**
 * Tests for the logsContent IndexedDB + cache seam (fake-indexeddb, like
 * database.test.ts).
 */
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ClientAPI,
  Log,
  LogHeader,
  LogPreview,
} from "../client/api/types";
import { DB_NAME } from "../client/database/schema";
import {
  createDatabaseService,
  DatabaseService,
} from "../client/database/service";
import { queryClient } from "../state/queryClient";

import { FetchEngine } from "./fetchEngine";
import { syncListing } from "./listingSync";
import {
  clearFile,
  createLogsContentSink,
  getLogRows,
  logKey,
  resolveLogKey,
  writeDetails,
  writeListing,
  writePreviews,
} from "./logsContent";

const invalidateListings = vi.hoisted(() => vi.fn());
vi.mock("./databaseListings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./databaseListings")>()),
  invalidateDatabaseLogsListings: invalidateListings,
}));

// The row-source predicate reads the shared service instance; default to
// "closed" (cache source) so the pre-existing tests, which pass their own
// db instance, keep the full-mirror behavior they assert.
const holder = vi.hoisted(() => {
  const state: { service: DatabaseService | null } = { service: null };
  return state;
});
vi.mock("./databaseServiceInstance", () => ({
  getDatabaseService: () =>
    holder.service ?? ({ opened: () => false } as DatabaseService),
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

  test("an empty changed set skips the identity write and the listing invalidation", async () => {
    const handles = [{ name: "file:///logs/a.eval", mtime: 5 }];
    await writeListing(db, "file:///logs", handles);
    expect(invalidateListings).toHaveBeenCalled();
    invalidateListings.mockClear();
    const writeSpy = vi.spyOn(db, "writeLogs");

    // The unchanged re-sync (engine diffed the listing to nothing): no
    // write, no invalidation — but the read-back contract still holds.
    const rows = await writeListing(db, "file:///logs", handles, []);

    expect(rows.map((row) => row.name)).toEqual(["file:///logs/a.eval"]);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(invalidateListings).not.toHaveBeenCalled();
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

describe("static listing reconciliation", () => {
  // End-to-end over the real seam (syncListing → FetchEngine → real sink →
  // fake-indexeddb): a static (no-mtime) listing change must reconcile the
  // DATABASE, not just the cache — paginated listing reads are db-backed,
  // so a cache-only activation would serve stale rows and retain deleted
  // files as ghosts.
  const logDir = "file:///logs";
  const name = (stem: string) => `${logDir}/${stem}.eval`;
  let db: DatabaseService;
  let engine: FetchEngine;

  beforeEach(async () => {
    invalidateListings.mockClear();
    db = createDatabaseService();
    holder.service = db;
    await db.openDatabase();
  });

  afterEach(async () => {
    engine?.stop();
    holder.service = null;
    queryClient.clear();
    await db.closeDatabase();
    await Dexie.delete(DB_NAME);
  });

  test("a changed static full response leaves only the new names, everywhere", async () => {
    const responses = [
      { files: [{ name: name("a") }, { name: name("b") }] },
      { files: [{ name: name("b") }, { name: name("c") }] },
    ];
    let call = 0;
    const api = {
      get_logs: () =>
        Promise.resolve({
          response_type: "full" as const,
          files: responses[Math.min(call++, 1)]!.files,
        }),
      // Backfill workers run after the sync settles; keep them inert.
      get_log_summaries_settled: () => Promise.resolve([]),
      get_log_details: () => Promise.reject(new Error("not under test")),
    } as unknown as ClientAPI;

    engine = new FetchEngine({ flushDelayMs: 0, statsDelayMs: 0 });
    await engine.start({
      api,
      database: db,
      sink: createLogsContentSink(db, logDir),
      logDir,
    });

    // First sync persists the static listing (cold db: full write).
    await syncListing(api, engine);
    expect(
      (await db.readLogs({ prefix: logDir }))?.map((row) => row.name)
    ).toEqual([name("a"), name("b")]);

    invalidateListings.mockClear();
    // The changed static response: `a` deleted, `c` added.
    await syncListing(api, engine);

    const expected = [name("b"), name("c")];
    const stored = (await db.readLogs({ prefix: logDir }))?.map(
      (row) => row.name
    );
    expect(stored?.sort()).toEqual(expected);
    expect(
      engine
        .listing()
        .map((h) => h.name)
        .sort()
    ).toEqual(expected);
    expect(
      getLogRows(logDir)
        .map((row) => row.name)
        .sort()
    ).toEqual(expected);
    // The UI refreshes without a manual retry or unrelated write.
    expect(invalidateListings).toHaveBeenCalled();
  });
});

describe("mirror demotion (step 7)", () => {
  let db: DatabaseService;
  const logDir = "/test/logs";

  const header = {
    eval: { task: "t", task_id: "tid", model: "gpt-4" },
    status: "success",
    sampleCount: 1,
    sampleErrorCount: 0,
    sampleLimits: [],
    sampleSummaries: [],
  } as unknown as LogHeader;

  beforeEach(async () => {
    db = createDatabaseService();
    holder.service = db;
    await db.openDatabase();
  });

  afterEach(async () => {
    holder.service = null;
    queryClient.clear();
    await db.closeDatabase();
    await Dexie.delete(DB_NAME);
  });

  test("db-backed: the collection keeps identity rows while the store keeps full rows", async () => {
    await writeListing(db, logDir, [
      { name: `${logDir}/a.eval`, task: "t", task_id: "tid", mtime: 5 },
    ]);
    await writePreviews(db, logDir, {
      [`${logDir}/a.eval`]: {
        status: "success",
        model: "gpt-4",
        task: "t",
        task_id: "tid",
      } as unknown as LogPreview,
    });
    await writeDetails(db, logDir, {
      [`${logDir}/a.eval`]: header as never,
    });

    const [mirrorRow] = getLogRows(logDir);
    // Identity columns survive (name resolution, engine diffing)...
    expect(mirrorRow?.name).toBe(`${logDir}/a.eval`);
    expect(mirrorRow?.task_id).toBe("tid");
    expect(mirrorRow?.mtime).toBe(5);
    expect(mirrorRow?.depth).toBe("detailed");
    // ...while the content tiers live only in the store.
    expect(mirrorRow?.status).toBeUndefined();
    expect(mirrorRow?.header).toBeUndefined();
    const stored = await db.readLogRow(`${logDir}/a.eval`);
    expect(stored?.status).toBe("success");
    expect(stored?.header).toBeDefined();

    // The identity mirror still resolves names.
    expect(resolveLogKey(logDir, "a.eval")).toBe(`${logDir}/a.eval`);
  });

  test("db-backed: an observed per-entity entry keeps its content across a preview merge", async () => {
    const name = `${logDir}/a.eval`;
    await writeListing(db, logDir, [{ name }]);
    // An observed log view: its entry holds the full detailed row.
    const detailed: Log = {
      name,
      depth: "detailed",
      header,
      status: "started",
      preview_attempts: 1,
      details_attempts: 1,
      details_settled_seq: 1,
    };
    queryClient.setQueryData<Log>(logKey(logDir, name), detailed);

    // A later preview lands (e.g. the running log settles).
    await writePreviews(db, logDir, {
      [name]: {
        status: "success",
      } as unknown as LogPreview,
    });

    const entry = queryClient.getQueryData<Log>(logKey(logDir, name));
    // The patch merged over the ENTRY's row, not the slim collection row —
    // the header must survive (staleTime: Infinity would never re-read it).
    expect(entry?.header).toBeDefined();
    expect(entry?.status).toBe("success");
    expect(entry?.depth).toBe("detailed");
    // The collection row itself stays identity-tier.
    expect(getLogRows(logDir)[0]?.status).toBeUndefined();
  });

  test("cache-source scopes keep the full mirror (it is the row source)", async () => {
    // Out-of-namespace listing: persistence degrades, mirror serves reads.
    await writeListing(db, "~/aliased", [
      { name: "file:///home/me/logs/a.eval" },
    ]);
    await writePreviews(db, "~/aliased", {
      "file:///home/me/logs/a.eval": {
        status: "success",
      } as unknown as LogPreview,
    });

    expect(getLogRows("~/aliased")[0]?.status).toBe("success");
  });
});
