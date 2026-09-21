/**
 * Tests for the logsContent IndexedDB + cache seam (fake-indexeddb, like
 * database.test.ts).
 */
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DB_NAME } from "../client/database/schema";
import {
  createDatabaseService,
  DatabaseService,
} from "../client/database/service";
import { queryClient } from "../state/queryClient";

import {
  clearFile,
  logKey,
  mergeFetchStates,
  setListing,
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
