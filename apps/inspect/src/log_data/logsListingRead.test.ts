/**
 * readLogsListing: source dispatch (database vs cache), retried marking, and
 * parity with the in-memory engine — the same fixtures through
 * `applyListingQuery` and the seam must agree (the migration safety net).
 * Uses fake-indexeddb (see setupTests) behind a real DatabaseService.
 */

import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Column } from "@tsmono/inspect-common/query";

import { applyListingQuery } from "../app/log-list/listing/applyListingQuery";
import { createListingPlan } from "../app/log-list/listing/planner";
import type { Log, LogPreview } from "../client/api/types";
import type { DatabaseListingResult } from "../client/database/listing";
import { DB_NAME } from "../client/database/schema";
import {
  createDatabaseService,
  type DatabaseService,
} from "../client/database/service";
import { queryClient } from "../state/queryClient";

import { databaseLogsListingKeyRoot } from "./databaseListings";
import { computeLogsWithRetried, type LogListingRow } from "./logListing";
import { setRows, writeListing } from "./logsContent";
import {
  readLogsListing,
  readLogsListingMatches,
  readLogsListingPage,
  readLogsOverview,
  type LogsListingPageQuery,
} from "./logsListingRead";

const holder = vi.hoisted(() => {
  const state: { service: DatabaseService | null } = { service: null };
  return state;
});

vi.mock("./databaseServiceInstance", () => ({
  getDatabaseService: () => holder.service,
}));

const preview = (overrides: Partial<LogPreview>): LogPreview => ({
  eval_id: "eval-1",
  run_id: "run-1",
  task: "test-task",
  task_id: "task-1",
  task_version: 1,
  version: 1,
  status: "success",
  error: null,
  model: "gpt-4",
  started_at: "2024-01-01T00:00:00Z",
  completed_at: "2024-01-01T01:00:00Z",
  ...overrides,
});

const getValue = (row: Log, column: string): unknown =>
  row[column as keyof Log];

describe("readLogsListing", () => {
  let databaseService: DatabaseService;

  beforeEach(async () => {
    databaseService = createDatabaseService();
    holder.service = databaseService;
    await databaseService.openDatabase();
  });

  afterEach(async () => {
    try {
      await databaseService.closeDatabase();
    } catch {
      // Already closed in the cache-dispatch test.
    }
    await Dexie.delete(DB_NAME);
  });

  test("matches the in-memory filter, sort, and pagination", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({
        model: "gpt-4",
        status: "success",
        task_id: "t-a",
      }),
      "/test/logs/b.json": preview({
        model: "claude",
        status: "success",
        task_id: "t-b",
      }),
      "/test/logs/c.json": preview({
        model: "gpt-4o",
        status: "error",
        task_id: "t-c",
      }),
      "/test/logs/d.json": preview({
        model: "gpt-5",
        status: "success",
        task_id: "t-d",
      }),
      "/other/e.json": preview({ model: "gpt-5", status: "success" }),
    });
    const source = (await databaseService.readLogs({
      prefix: "/test/logs",
    })) as Log[];
    const query = {
      filter: new Column("model")
        .ilike("gpt%")
        .and(new Column("status").ne("error")),
      orderBy: [{ column: "name", direction: "DESC" as const }],
      pagination: { limit: 1, cursor: null, direction: "forward" as const },
      getValue,
      getComparator: () => undefined,
    };

    // The seam marks retried runs over its scan; mirror that on the
    // in-memory side so the parity compare sees identical rows.
    const expected = applyListingQuery(computeLogsWithRetried(source), query);
    const actual = await readLogsListing(
      "/test/logs",
      "/test/logs",
      (log: LogListingRow) => log as Log,
      createListingPlan(query)
    );

    expect(actual).toEqual(expected);
    expect(actual.items.map((row) => row.name)).toEqual(["/test/logs/d.json"]);
    expect(actual.total_count).toBe(2);
    expect(actual.next_cursor).toEqual({ offset: 1 });
  });

  test("marks retried runs across the scan and lets toRow drop them", async () => {
    // Same parent dir + task_id: the newest successful run wins, the other
    // is retried.
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_task.json": preview({ task_id: "shared" }),
      "/test/logs/2024-01-02_task.json": preview({ task_id: "shared" }),
    });

    const rows = await readLogsListing(
      "/test/logs",
      "/test/logs",
      (log: LogListingRow) => (log.retried ? undefined : log),
      createListingPlan({ getValue, getComparator: () => undefined })
    );
    expect(rows.total_count).toBe(1);
    expect(rows.items[0]?.name).toBe("/test/logs/2024-01-02_task.json");

    const all = await readLogsListing(
      "/test/logs",
      "/test/logs",
      (log: LogListingRow) => log,
      createListingPlan({ getValue, getComparator: () => undefined })
    );
    expect(all.total_count).toBe(2);
  });

  test("serves from the react-query cache when the database is not open", async () => {
    setRows("/cache/logs", [
      { name: "/cache/logs/a.json", task: "t" } as Log,
      { name: "/cache/logs-other/b.json", task: "t" } as Log,
    ]);
    await databaseService.closeDatabase();

    const result = await readLogsListing(
      "/cache/logs",
      "/cache/logs",
      (log: LogListingRow) => log,
      createListingPlan({ getValue, getComparator: () => undefined })
    );
    // Scoped by boundary-safe prefix: the sibling dir's row is excluded.
    expect(result.items.map((row) => row.name)).toEqual(["/cache/logs/a.json"]);
  });

  test("serves every cache row for an out-of-namespace (cache-only) scope", async () => {
    // An older view server can report an aliased local path as log_dir while
    // the listing names are file:// URIs; writeListing degrades the scope to
    // cache-only. Those names never match the scope prefix, so the cache
    // read must not prefix-filter them away.
    await writeListing(databaseService, "/alias/logs", [
      { name: "file:///real/logs/a.json" },
      { name: "file:///real/logs/b.json" },
    ]);

    const result = await readLogsListing(
      "/alias/logs",
      "/alias/logs",
      (log: LogListingRow) => log,
      createListingPlan({ getValue, getComparator: () => undefined })
    );
    expect(result.items.map((row) => row.name).sort()).toEqual([
      "file:///real/logs/a.json",
      "file:///real/logs/b.json",
    ]);
  });
});

describe("readLogsListingPage", () => {
  let databaseService: DatabaseService;

  const identityRow = (log: LogListingRow): Log => log;

  const pageQuery = (
    overrides?: Partial<LogsListingPageQuery<Log>>
  ): LogsListingPageQuery<Log> => ({
    logDir: "/test/logs",
    prefix: "/test/logs",
    toRow: identityRow,
    universe: "test-universe",
    accessorsKey: "accessors-v1",
    plan: createListingPlan({ getValue, getComparator: () => undefined }),
    ...overrides,
  });

  /** Walk every page of the paged path (the grid's fetchNextPage loop). */
  const collectPages = async (
    query: LogsListingPageQuery<Log>,
    limit: number
  ): Promise<DatabaseListingResult<Log>[]> => {
    const pages: DatabaseListingResult<Log>[] = [];
    let cursor: DatabaseListingResult<Log>["next_cursor"] = null;
    do {
      const page: DatabaseListingResult<Log> = await readLogsListingPage(
        query,
        { cursor, limit }
      );
      pages.push(page);
      cursor = page.next_cursor;
    } while (cursor !== null);
    return pages;
  };

  beforeEach(async () => {
    databaseService = createDatabaseService();
    holder.service = databaseService;
    await databaseService.openDatabase();
    queryClient.clear();
  });

  afterEach(async () => {
    queryClient.clear();
    try {
      await databaseService.closeDatabase();
    } catch {
      // Already closed in the cache-dispatch test.
    }
    await Dexie.delete(DB_NAME);
  });

  test("pages agree with the in-memory engine page-by-page and on total_count", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ model: "gpt-4", task_id: "t-a" }),
      "/test/logs/b.json": preview({ model: "claude", task_id: "t-b" }),
      "/test/logs/c.json": preview({
        model: "gpt-4o",
        status: "error",
        task_id: "t-c",
      }),
      "/test/logs/d.json": preview({ model: "gpt-5", task_id: "t-d" }),
      "/test/logs/e.json": preview({ model: "gpt-4.1", task_id: "t-e" }),
      "/other/f.json": preview({ model: "gpt-5", task_id: "t-f" }),
    });
    const source = (await databaseService.readLogs({
      prefix: "/test/logs",
    })) as Log[];
    const filter = new Column("model")
      .ilike("gpt%")
      .and(new Column("status").ne("error"));
    const orderBy = [{ column: "name", direction: "DESC" as const }];
    const listingQuery = {
      filter,
      orderBy,
      getValue,
      getComparator: () => undefined,
    };

    const query = pageQuery({
      filter,
      orderBy,
      plan: createListingPlan(listingQuery),
    });
    const limit = 2;
    const pages = await collectPages(query, limit);

    // The same fixtures through the in-memory engine, page-by-page — the
    // migration safety net (mirror the seam's retried marking first).
    const marked = computeLogsWithRetried(source);
    pages.forEach((page, index) => {
      const expected = applyListingQuery(marked, {
        ...listingQuery,
        pagination: {
          limit,
          cursor: index === 0 ? null : { offset: index * limit },
          direction: "forward" as const,
        },
      });
      expect(page).toEqual(expected);
    });
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.total_count)).toEqual([3, 3]);
  });

  test("pages re-attach the scan's retried marks to bulkGot records", async () => {
    // Same parent dir + task_id: the newer run wins, the older is retried.
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_task.json": preview({ task_id: "shared" }),
      "/test/logs/2024-01-02_task.json": preview({ task_id: "shared" }),
    });
    const orderBy = [{ column: "name", direction: "ASC" as const }];
    const query = pageQuery({
      orderBy,
      plan: createListingPlan({
        orderBy,
        getValue,
        getComparator: () => undefined,
      }),
    });

    const [first, second] = await collectPages(query, 1);
    // Page one is served inline from the build; page two goes through the
    // bulkGet path — both must carry the cross-row retried derivation.
    expect(first?.items[0]).toMatchObject({
      name: "/test/logs/2024-01-01_task.json",
      retried: true,
    });
    expect(second?.items[0]).toMatchObject({
      name: "/test/logs/2024-01-02_task.json",
      retried: false,
    });
  });

  test("serves the first page from the snapshot build without a second read", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
      "/test/logs/c.json": preview({ task_id: "t-c" }),
    });
    const readLogRowsSpy = vi.spyOn(databaseService, "readLogRows");

    const query = pageQuery();
    const first = await readLogsListingPage(query, { cursor: null, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(readLogRowsSpy).not.toHaveBeenCalled();

    const second = await readLogsListingPage(query, {
      cursor: first.next_cursor,
      limit: 2,
    });
    expect(second.items).toHaveLength(1);
    expect(readLogRowsSpy).toHaveBeenCalledTimes(1);
  });

  test("a single full-size page (no limit) matches the unpaged read", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
    });

    const query = pageQuery();
    const paged = await readLogsListingPage(query, { cursor: null });
    const unpaged = await readLogsListing(
      "/test/logs",
      "/test/logs",
      identityRow,
      query.plan
    );
    expect(paged).toEqual(unpaged);
    expect(paged.next_cursor).toBeNull();
  });

  test("drops holes for keys deleted between snapshot and page read", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
      "/test/logs/c.json": preview({ task_id: "t-c" }),
      "/test/logs/d.json": preview({ task_id: "t-d" }),
    });
    const orderBy = [{ column: "name", direction: "ASC" as const }];
    const query = pageQuery({
      orderBy,
      plan: createListingPlan({
        orderBy,
        getValue,
        getComparator: () => undefined,
      }),
    });

    // Prime the snapshot, then delete a row from a later page's slice.
    const first = await readLogsListingPage(query, { cursor: null, limit: 2 });
    await databaseService.clearCacheForFile("/test/logs/c.json");

    const second = await readLogsListingPage(query, {
      cursor: first.next_cursor,
      limit: 2,
    });
    expect(second.items.map((row) => row.name)).toEqual(["/test/logs/d.json"]);
    // The cursor indexes the (stale-until-invalidated) key list, not served
    // rows — total_count updates on the next snapshot rebuild.
    expect(second.total_count).toBe(4);
    expect(second.next_cursor).toBeNull();
  });

  test("invalidation rebuilds the snapshot and streams new rows in", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
    });
    const query = pageQuery();
    const before = await readLogsListingPage(query, { cursor: null, limit: 5 });
    expect(before.total_count).toBe(1);

    // A replication write lands and the write path invalidates the listing
    // root: the (observer-less) snapshot must rebuild on the next page read,
    // not serve its stale keys.
    await databaseService.writeLogPreviews({
      "/test/logs/b.json": preview({ task_id: "t-b" }),
    });
    await queryClient.invalidateQueries({
      queryKey: databaseLogsListingKeyRoot,
    });

    const after = await readLogsListingPage(query, { cursor: null, limit: 5 });
    expect(after.total_count).toBe(2);
    expect(after.items.map((row) => row.name).sort()).toEqual([
      "/test/logs/a.json",
      "/test/logs/b.json",
    ]);
  });

  test("cache-only scopes fall back to the scan path as one full page", async () => {
    setRows("/cache/logs", [
      { name: "/cache/logs/a.json", task: "t" } as Log,
      { name: "/cache/logs/b.json", task: "t" } as Log,
    ]);
    await databaseService.closeDatabase();

    const query = pageQuery({ logDir: "/cache/logs", prefix: "/cache/logs" });
    const page = await readLogsListingPage(query, { cursor: null, limit: 1 });
    // The whole listing in one page: cache-only scopes don't paginate.
    expect(page.items.map((row) => row.name)).toEqual([
      "/cache/logs/a.json",
      "/cache/logs/b.json",
    ]);
    expect(page.total_count).toBe(2);
    expect(page.next_cursor).toBeNull();
  });
});

describe("readLogsOverview", () => {
  let databaseService: DatabaseService;

  beforeEach(async () => {
    databaseService = createDatabaseService();
    holder.service = databaseService;
    await databaseService.openDatabase();
  });

  afterEach(async () => {
    await databaseService.closeDatabase();
    await Dexie.delete(DB_NAME);
  });

  const directChildOf =
    (dir: string) =>
    (log: LogListingRow): boolean =>
      new RegExp(`^${dir}/[^/]+$`).test(log.name);

  test("aggregates folders, counts, and task ids in one scan", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a", status: "started" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
      "/test/logs/sub/c.json": preview({ task_id: "t-c" }),
      "/test/logs/sub/d.json": preview({ task_id: "t-d" }),
    });

    const overview = await readLogsOverview("/test/logs", {
      folderDir: "/test/logs",
      showRetriedLogs: false,
      isCandidate: directChildOf("/test/logs"),
    });

    expect(overview.taskIds.sort()).toEqual(["t-a", "t-b", "t-c", "t-d"]);
    expect(overview.fileCount).toBe(2);
    expect(overview.startedCount).toBe(1);
    expect(overview.retriedCount).toBe(0);
    expect(overview.soleFileName).toBeUndefined();
    expect(overview.folders).toEqual([{ name: "sub", itemCount: 2 }]);
  });

  test("folder counts don't bleed into prefix-sharing siblings or clip to a nested subtree", async () => {
    await databaseService.writeLogPreviews({
      // "sub" is a name-prefix of "sub2": each must count only its own logs.
      "/test/logs/sub/nested/a.json": preview({ task_id: "t-a" }),
      "/test/logs/sub/b.json": preview({ task_id: "t-b" }),
      "/test/logs/sub2/c.json": preview({ task_id: "t-c" }),
      "/test/logs/sub2/d.json": preview({ task_id: "t-d" }),
      "/test/logs/sub2/e.json": preview({ task_id: "t-e" }),
    });

    const overview = await readLogsOverview("/test/logs", {
      folderDir: "/test/logs",
      showRetriedLogs: false,
      isCandidate: directChildOf("/test/logs"),
    });

    // "sub" counts its whole subtree even when first seen via the nested
    // file; "sub2" isn't inflated by "sub" rows (nor vice versa).
    const folders = [...overview.folders].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    expect(folders).toEqual([
      { name: "sub", itemCount: 2 },
      { name: "sub2", itemCount: 3 },
    ]);
  });

  test("counts retried runs and applies retried-hiding to file facts", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_task.json": preview({ task_id: "shared" }),
      "/test/logs/2024-01-02_task.json": preview({ task_id: "shared" }),
    });
    const view = {
      showRetriedLogs: false,
      isCandidate: directChildOf("/test/logs"),
    };

    const hidden = await readLogsOverview("/test/logs", view);
    expect(hidden.fileCount).toBe(1);
    expect(hidden.retriedCount).toBe(1);
    expect(hidden.soleFileName).toBe("/test/logs/2024-01-02_task.json");
    expect(hidden.folders).toEqual([]);

    const shown = await readLogsOverview("/test/logs", {
      ...view,
      showRetriedLogs: true,
    });
    expect(shown.fileCount).toBe(2);
    expect(shown.retriedCount).toBe(1);
    expect(shown.soleFileName).toBeUndefined();
  });
});

describe("readLogsListingMatches", () => {
  let databaseService: DatabaseService;

  beforeEach(async () => {
    databaseService = createDatabaseService();
    holder.service = databaseService;
    await databaseService.openDatabase();
  });

  afterEach(async () => {
    await databaseService.closeDatabase();
    await Dexie.delete(DB_NAME);
  });

  test("returns matching row ids in listing order under the active plan", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task: "alpha", task_id: "t-a" }),
      "/test/logs/b.json": preview({
        task: "beta",
        task_id: "t-b",
        model: "gpt-4o",
      }),
      "/test/logs/c.json": preview({ task: "alphabet", task_id: "t-c" }),
      // Text matches the term but the plan's filter excludes it: matches
      // must respect the same filter as the row query.
      "/test/logs/d.json": preview({
        task: "alpha",
        task_id: "t-d",
        model: "claude",
      }),
    });

    const matches = await readLogsListingMatches(
      "/test/logs",
      "/test/logs",
      (log: LogListingRow) => log as Log,
      createListingPlan({
        filter: new Column("model").ilike("gpt%"),
        orderBy: [{ column: "name", direction: "DESC" as const }],
        getValue,
        getComparator: () => undefined,
      }),
      {
        // Lowercased per rowText's contract; the term may be any case.
        term: "ALPHA",
        getRowId: (row) => row.name,
        rowText: (row) => `${row.name}\n${row.task ?? ""}`.toLowerCase(),
      }
    );

    expect(matches).toEqual(["/test/logs/c.json", "/test/logs/a.json"]);
  });
});
