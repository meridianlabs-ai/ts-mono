/**
 * The listing data access: source dispatch (database vs cache), retried
 * marking, the instance's internal snapshot cache (dedupe, epoch
 * invalidation, error eviction), and parity with the in-memory engine — the
 * same fixtures through `applyListingQuery` and the seam must agree (the
 * migration safety net). Uses fake-indexeddb (see setupTests) behind a real
 * DatabaseService.
 */

import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Column } from "@tsmono/inspect-common/query";
import type { Condition, OrderByModel } from "@tsmono/inspect-common/query";

import type { Log, LogHeader, LogPreview } from "../client/api/types";
import { DB_NAME } from "../client/database/schema";
import {
  createDatabaseService,
  type DatabaseService,
} from "../client/database/service";

import { applyListingQuery } from "./listing/applyListingQuery";
import {
  createLogColumnSchema,
  parentDirCondition,
} from "./listing/logColumnSchema";
import { computeLogsWithRetried, type LogListingRow } from "./logListing";
import { setRows, writeListing } from "./logsContent";
import { bumpLogsListingEpoch } from "./logsListingEpoch";
import {
  createLogsListingData,
  readLogsColumnFacts,
  readLogsOverview,
  readSamplesLogFacts,
  type LogsListingData,
  type LogsListingPageResult,
} from "./logsListingRead";
import { computeScorerMap } from "./scoreSchema";

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

/** The real schema with no scorer columns — what queries evaluate through. */
const schema = createLogColumnSchema({});

describe("listing reads", () => {
  let databaseService: DatabaseService;

  const createData = (logDir: string): LogsListingData<LogListingRow> =>
    createLogsListingData({ logDir, schema });

  const wholePage = { cursor: null, direction: "forward", limit: 100 } as const;

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
    const filter = new Column("model")
      .ilike("gpt%")
      .and(new Column("status").ne("error"));
    const orderBy = [{ column: "name", direction: "DESC" as const }];

    // The seam marks retried runs over its scan; mirror that on the
    // in-memory side so the parity compare sees identical rows.
    const expected = applyListingQuery(computeLogsWithRetried(source), {
      filter,
      orderBy,
      pagination: { limit: 1, cursor: null, direction: "forward" as const },
      getValue,
      getComparator: () => undefined,
    });
    const actual = await createData("/test/logs").getPage(filter, orderBy, {
      cursor: null,
      direction: "forward",
      limit: 1,
    });

    const { universe_task_ids, ...parityFields } = actual;
    expect(parityFields).toEqual(expected);
    expect(universe_task_ids).toBeDefined();
    expect(actual.items.map((row) => row.name)).toEqual(["/test/logs/d.json"]);
    expect(actual.total_count).toBe(2);
    expect(actual.next_cursor).toEqual({ offset: 1 });
  });

  test("hides retried runs via the retried = false condition", async () => {
    // Same parent dir + task_id: the newest successful run wins, the other
    // is retried.
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_task.json": preview({ task_id: "shared" }),
      "/test/logs/2024-01-02_task.json": preview({ task_id: "shared" }),
    });

    const data = createData("/test/logs");
    const hidden = await data.getPage(
      new Column("retried").eq(false),
      undefined,
      wholePage
    );
    expect(hidden.total_count).toBe(1);
    expect(hidden.items[0]?.name).toBe("/test/logs/2024-01-02_task.json");

    const all = await data.getPage(undefined, undefined, wholePage);
    expect(all.total_count).toBe(2);
  });

  test("retried = false keeps task-id-less logs (the mark is total)", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_task.json": preview({ task_id: "shared" }),
      "/test/logs/2024-01-02_task.json": preview({ task_id: "shared" }),
      // Older log format: no task_id, so it can never be a retry — the
      // condition must keep it (SQL null semantics would drop a partial
      // column here).
      "/test/logs/old.json": preview({ task_id: null as unknown as string }),
    });

    const page = await createData("/test/logs").getPage(
      new Column("retried").eq(false),
      [{ column: "name", direction: "ASC" }],
      wholePage
    );
    expect(page.items.map((row) => row.name)).toEqual([
      "/test/logs/2024-01-02_task.json",
      "/test/logs/old.json",
    ]);
  });

  test("a parent_dir condition lists direct children and narrows the scan", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/sub/b.json": preview({ task_id: "t-b" }),
      "/test/logs/sub/nested/c.json": preview({ task_id: "t-c" }),
    });
    const readLogsSpy = vi.spyOn(databaseService, "readLogs");

    const page = await createData("/test/logs").getPage(
      new Column("parent_dir").eq("/test/logs/sub"),
      undefined,
      wholePage
    );

    // Direct children only — the nested file displays through its folder.
    expect(page.items.map((row) => row.name)).toEqual([
      "/test/logs/sub/b.json",
    ]);
    // The scan derives from the condition rather than arriving as a second,
    // manually-coordinated input — and pins the stored parent_dir index
    // (exactly the direct children) rather than ranging over the subtree.
    expect(readLogsSpy).toHaveBeenCalledWith({ parentDir: "/test/logs/sub" });
  });

  test("parentDirCondition normalizes a slash-terminated directory", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/sub/b.json": preview({ task_id: "t-b" }),
    });
    const readLogsSpy = vi.spyOn(databaseService, "readLogs");

    // Both the index scan and the plan's in-memory re-check compare the
    // stored `dirname` form (never slash-terminated); the condition builder
    // owns that normalization, so a directory path with a trailing slash
    // must still list its children instead of silently matching nothing.
    const page = await createData("/test/logs").getPage(
      parentDirCondition("/test/logs/sub/"),
      undefined,
      wholePage
    );

    expect(page.items.map((row) => row.name)).toEqual([
      "/test/logs/sub/b.json",
    ]);
    expect(readLogsSpy).toHaveBeenCalledWith({ parentDir: "/test/logs/sub" });
  });

  test("serves from the react-query cache when the database is not open", async () => {
    setRows("/cache/logs", [
      { name: "/cache/logs/a.json", task: "t" } as Log,
      { name: "/cache/logs-other/b.json", task: "t" } as Log,
    ]);
    await databaseService.closeDatabase();

    const result = await createData("/cache/logs").getPage(
      undefined,
      undefined,
      wholePage
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

    const result = await createData("/alias/logs").getPage(
      undefined,
      undefined,
      wholePage
    );
    expect(result.items.map((row) => row.name).sort()).toEqual([
      "file:///real/logs/a.json",
      "file:///real/logs/b.json",
    ]);
  });
});

describe("LogsListingData.getPage", () => {
  let databaseService: DatabaseService;

  const createData = (logDir = "/test/logs"): LogsListingData<LogListingRow> =>
    createLogsListingData({ logDir, schema });

  /** Walk every page of the paged path (the grid's fetchNextPage loop). */
  const collectPages = async (
    data: LogsListingData<Log>,
    query: { filter?: Condition; orderBy?: OrderByModel[] },
    limit: number
  ): Promise<LogsListingPageResult<Log>[]> => {
    const pages: LogsListingPageResult<Log>[] = [];
    let cursor: LogsListingPageResult<Log>["next_cursor"] = null;
    do {
      const page: LogsListingPageResult<Log> = await data.getPage(
        query.filter,
        query.orderBy,
        { cursor, direction: "forward", limit }
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
  });

  afterEach(async () => {
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

    const limit = 2;
    const pages = await collectPages(createData(), { filter, orderBy }, limit);

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
      // The snapshot-scoped aggregate rides beside the parity fields.
      const { universe_task_ids, ...parityFields } = page;
      expect(parityFields).toEqual(expected);
      expect([...(universe_task_ids ?? [])].sort()).toEqual([
        "t-a",
        "t-d",
        "t-e",
      ]);
    });
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.total_count)).toEqual([3, 3]);
  });

  test("a failed store read during the snapshot build rejects instead of caching an empty listing", async () => {
    // `readLogs` swallows Dexie errors to null. Degrading to the react-query
    // mirror (which can be GC'd empty) would cache keys: [] as a fresh
    // successful snapshot — "No matching items" over a populated database,
    // with no error surfaced. The failure must reject so the listing query
    // settles in error (same rationale as readLogRows' deliberate no-catch),
    // and the internal cache must evict the rejected build.
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
    });
    vi.spyOn(databaseService, "readLogs").mockResolvedValue(null);

    const data = createData();
    await expect(
      data.getPage(undefined, undefined, {
        cursor: null,
        direction: "forward",
        limit: 10,
      })
    ).rejects.toThrow(/listing/i);

    // The failure must not have been cached: with the store healthy again,
    // the same instance serves the real rows.
    vi.restoreAllMocks();
    const recovered = await data.getPage(undefined, undefined, {
      cursor: null,
      direction: "forward",
      limit: 10,
    });
    expect(recovered.items.map((row) => row.name)).toEqual([
      "/test/logs/a.json",
    ]);
  });

  test("pages re-attach the scan's retried marks to bulkGot records", async () => {
    // Same parent dir + task_id: the newer run wins, the older is retried.
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_task.json": preview({ task_id: "shared" }),
      "/test/logs/2024-01-02_task.json": preview({ task_id: "shared" }),
    });
    const orderBy = [{ column: "name", direction: "ASC" as const }];

    const [first, second] = await collectPages(createData(), { orderBy }, 1);
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

    const data = createData();
    const first = await data.getPage(undefined, undefined, {
      cursor: null,
      direction: "forward",
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(readLogRowsSpy).not.toHaveBeenCalled();

    const second = await data.getPage(undefined, undefined, {
      cursor: first.next_cursor,
      direction: "forward",
      limit: 2,
    });
    expect(second.items).toHaveLength(1);
    expect(readLogRowsSpy).toHaveBeenCalledTimes(1);
  });

  test("concurrent page reads of one query share one snapshot scan", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
    });
    const readLogsSpy = vi.spyOn(databaseService, "readLogs");

    const data = createData();
    const [first, second] = await Promise.all([
      data.getPage(undefined, undefined, {
        cursor: null,
        direction: "forward",
        limit: 1,
      }),
      data.getPage(undefined, undefined, {
        cursor: { offset: 1 },
        direction: "forward",
        limit: 1,
      }),
    ]);
    // The promise-valued cache dedupes: both pages await the same build.
    expect(readLogsSpy).toHaveBeenCalledTimes(1);
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
  });

  test("a single page holding the whole universe matches the unpaged read", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
    });

    const data = createData();
    const paged = await data.getPage(undefined, undefined, {
      cursor: null,
      direction: "forward",
      limit: 100,
    });
    const source = (await databaseService.readLogs({
      prefix: "/test/logs",
    })) as Log[];
    const unpaged = applyListingQuery(computeLogsWithRetried(source), {
      getValue,
      getComparator: () => undefined,
    });
    // The snapshot-scoped aggregate rides beside the parity fields.
    const { universe_task_ids, ...parityFields } = paged;
    expect(parityFields).toEqual(unpaged);
    expect([...(universe_task_ids ?? [])].sort()).toEqual(["t-a", "t-b"]);
    expect(paged.next_cursor).toBeNull();
  });

  test("serves a backward page as the slice before the cursor", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
      "/test/logs/c.json": preview({ task_id: "t-c" }),
    });
    const orderBy = [{ column: "name", direction: "ASC" as const }];

    const data = createData();
    // Null backward cursor: from the end of the result.
    const tail = await data.getPage(undefined, orderBy, {
      cursor: null,
      direction: "backward",
      limit: 2,
    });
    expect(tail.items.map((row) => row.name)).toEqual([
      "/test/logs/b.json",
      "/test/logs/c.json",
    ]);
    expect(tail.next_cursor).toEqual({ offset: 1 });

    const head = await data.getPage(undefined, orderBy, {
      cursor: tail.next_cursor,
      direction: "backward",
      limit: 2,
    });
    expect(head.items.map((row) => row.name)).toEqual(["/test/logs/a.json"]);
    expect(head.next_cursor).toBeNull();
  });

  test("drops holes for keys deleted between snapshot and page read", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
      "/test/logs/c.json": preview({ task_id: "t-c" }),
      "/test/logs/d.json": preview({ task_id: "t-d" }),
    });
    const orderBy = [{ column: "name", direction: "ASC" as const }];

    // Prime the snapshot, then delete a row from a later page's slice.
    const data = createData();
    const first = await data.getPage(undefined, orderBy, {
      cursor: null,
      direction: "forward",
      limit: 2,
    });
    await databaseService.clearCacheForFile("/test/logs/c.json");

    const second = await data.getPage(undefined, orderBy, {
      cursor: first.next_cursor,
      direction: "forward",
      limit: 2,
    });
    expect(second.items.map((row) => row.name)).toEqual(["/test/logs/d.json"]);
    // The cursor indexes the (stale-until-invalidated) key list, not served
    // rows — total_count updates on the next snapshot rebuild.
    expect(second.total_count).toBe(4);
    expect(second.next_cursor).toBeNull();
  });

  test("drops holes for records mutated out of the filter between snapshot and page read", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ model: "gpt-4", task_id: "t-a" }),
      "/test/logs/b.json": preview({ model: "gpt-4o", task_id: "t-b" }),
      "/test/logs/c.json": preview({ model: "gpt-5", task_id: "t-c" }),
      "/test/logs/d.json": preview({ model: "gpt-4.1", task_id: "t-d" }),
    });
    const filter = new Column("model").ilike("gpt%");
    const orderBy = [{ column: "name", direction: "ASC" as const }];

    // Prime the snapshot, then a replication write flips a later-page row
    // out of the filter before its page is read.
    const data = createData();
    const first = await data.getPage(filter, orderBy, {
      cursor: null,
      direction: "forward",
      limit: 2,
    });
    await databaseService.writeLogPreviews({
      "/test/logs/c.json": preview({ model: "claude", task_id: "t-c" }),
    });

    // The page must not serve a row the active filter excludes — it runs
    // short (like a deleted key) until the next invalidation rebuilds the
    // key list.
    const second = await data.getPage(filter, orderBy, {
      cursor: first.next_cursor,
      direction: "forward",
      limit: 2,
    });
    expect(second.items.map((row) => row.name)).toEqual(["/test/logs/d.json"]);
    expect(second.total_count).toBe(4);
    expect(second.next_cursor).toBeNull();
  });

  test("pages carry the filtered universe's distinct task ids for the pending anti-join", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ model: "gpt-4", task_id: "t-a" }),
      "/test/logs/b.json": preview({ model: "gpt-4o", task_id: "t-b" }),
      "/test/logs/c.json": preview({ model: "claude", task_id: "t-c" }),
    });
    const filter = new Column("model").ilike("gpt%");

    // Every page reports the whole filtered universe's task ids (parity with
    // the pre-pagination anti-join, which saw the full filtered row set) —
    // a pending task whose file sits on an unloaded page must still settle.
    const data = createData();
    const first = await data.getPage(filter, undefined, {
      cursor: null,
      direction: "forward",
      limit: 1,
    });
    expect([...(first.universe_task_ids ?? [])].sort()).toEqual(["t-a", "t-b"]);
    const second = await data.getPage(filter, undefined, {
      cursor: first.next_cursor,
      direction: "forward",
      limit: 1,
    });
    expect([...(second.universe_task_ids ?? [])].sort()).toEqual([
      "t-a",
      "t-b",
    ]);
  });

  test("a failed bulk read rejects the page instead of serving deleted-key holes", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
      "/test/logs/c.json": preview({ task_id: "t-c" }),
    });
    const data = createData();
    const first = await data.getPage(undefined, undefined, {
      cursor: null,
      direction: "forward",
      limit: 2,
    });

    // A transient store failure must surface as a page error (React Query
    // error state → banner, paused auto-fetch) — an empty page would be
    // indistinguishable from mass deletion and silently truncate the list.
    vi.spyOn(databaseService, "readLogRows").mockRejectedValue(
      new Error("InvalidStateError: database is closing")
    );
    await expect(
      data.getPage(undefined, undefined, {
        cursor: first.next_cursor,
        direction: "forward",
        limit: 2,
      })
    ).rejects.toThrow("database is closing");
  });

  test("an epoch bump rebuilds the snapshot and streams new rows in", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
    });
    const data = createData();
    const before = await data.getPage(undefined, undefined, {
      cursor: null,
      direction: "forward",
      limit: 5,
    });
    expect(before.total_count).toBe(1);

    // A replication write lands and the write path bumps the listing epoch:
    // the cached snapshot must rebuild on the next page read, not serve its
    // stale keys.
    await databaseService.writeLogPreviews({
      "/test/logs/b.json": preview({ task_id: "t-b" }),
    });
    bumpLogsListingEpoch();

    const after = await data.getPage(undefined, undefined, {
      cursor: null,
      direction: "forward",
      limit: 5,
    });
    expect(after.total_count).toBe(2);
    expect(after.items.map((row) => row.name).sort()).toEqual([
      "/test/logs/a.json",
      "/test/logs/b.json",
    ]);
  });

  test("cache-only scopes honor the page contract (a source flip can't re-serve the whole listing as one page)", async () => {
    setRows("/cache/logs", [
      { name: "/cache/logs/a.json", task: "t", task_id: "t-a" } as Log,
      { name: "/cache/logs/b.json", task: "t", task_id: "t-b" } as Log,
      { name: "/cache/logs/c.json", task: "t", task_id: "t-c" } as Log,
    ]);
    await databaseService.closeDatabase();
    const orderBy = [{ column: "name", direction: "ASC" as const }];

    const data = createData("/cache/logs");
    const first = await data.getPage(undefined, orderBy, {
      cursor: null,
      direction: "forward",
      limit: 2,
    });
    expect(first.items.map((row) => row.name)).toEqual([
      "/cache/logs/a.json",
      "/cache/logs/b.json",
    ]);
    expect(first.total_count).toBe(3);
    // The whole universe's task ids still ride on every page — files on
    // unloaded pages must settle their pending rows.
    expect([...(first.universe_task_ids ?? [])].sort()).toEqual([
      "t-a",
      "t-b",
      "t-c",
    ]);
    expect(first.next_cursor).toEqual({ offset: 2 });

    const second = await data.getPage(undefined, orderBy, {
      cursor: first.next_cursor,
      direction: "forward",
      limit: 2,
    });
    expect(second.items.map((row) => row.name)).toEqual(["/cache/logs/c.json"]);
    expect(second.next_cursor).toBeNull();

    // Bidirectional cursors, like the database path.
    const backward = await data.getPage(undefined, orderBy, {
      cursor: { offset: 2 },
      direction: "backward",
      limit: 2,
    });
    expect(backward.items.map((row) => row.name)).toEqual([
      "/cache/logs/a.json",
      "/cache/logs/b.json",
    ]);
    expect(backward.next_cursor).toBeNull();
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

  test("aggregates folders, counts, and task ids in one scan", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a", status: "started" }),
      "/test/logs/b.json": preview({ task_id: "t-b" }),
      "/test/logs/sub/c.json": preview({ task_id: "t-c" }),
      "/test/logs/sub/d.json": preview({ task_id: "t-d" }),
    });

    const overview = await readLogsOverview("/test/logs", schema, {
      folderDir: "/test/logs",
      showRetriedLogs: false,
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

    const overview = await readLogsOverview("/test/logs", schema, {
      folderDir: "/test/logs",
      showRetriedLogs: false,
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

  test("a slash-terminated folderDir counts the same membership", async () => {
    // Membership runs through parentDirCondition, whose normalization must
    // keep the trailing-slash tolerance isInDirectory used to provide.
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a" }),
      "/test/logs/sub/b.json": preview({ task_id: "t-b" }),
    });

    const overview = await readLogsOverview("/test/logs", schema, {
      folderDir: "/test/logs/",
      showRetriedLogs: false,
    });

    expect(overview.fileCount).toBe(1);
    expect(overview.soleFileName).toBe("/test/logs/a.json");
  });

  test("counts retried runs and applies retried-hiding to file facts", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_task.json": preview({ task_id: "shared" }),
      "/test/logs/2024-01-02_task.json": preview({ task_id: "shared" }),
    });
    const options = {
      folderDir: "/test/logs",
      showRetriedLogs: false,
    };

    const hidden = await readLogsOverview("/test/logs", schema, options);
    expect(hidden.fileCount).toBe(1);
    expect(hidden.retriedCount).toBe(1);
    expect(hidden.soleFileName).toBe("/test/logs/2024-01-02_task.json");
    expect(hidden.folders).toEqual([]);

    const shown = await readLogsOverview("/test/logs", schema, {
      ...options,
      showRetriedLogs: true,
    });
    expect(shown.fileCount).toBe(2);
    expect(shown.retriedCount).toBe(1);
    expect(shown.soleFileName).toBeUndefined();
  });
});

describe("readLogsColumnFacts", () => {
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

  const header = (
    scores: Array<{ name: string; metrics: Record<string, number | string> }>,
    sampleLimits: string[] = []
  ): LogHeader =>
    ({
      results: {
        scores: scores.map((s) => ({
          name: s.name,
          metrics: Object.fromEntries(
            Object.entries(s.metrics).map(([m, value]) => [m, { value }])
          ),
        })),
      },
      sampleLimits,
    }) as unknown as LogHeader;

  const writeDetailed = (headers: Record<string, LogHeader>) =>
    databaseService.writeLogDetails(
      Object.fromEntries(
        Object.entries(headers).map(([file, h]) => [
          file,
          {
            header: h,
            patch: { depth: "detailed" as const, header: h },
            summaries: [],
          },
        ])
      )
    );

  test("scans the scope for scorer columns, agreeing with the in-memory computation", async () => {
    const headers = {
      "/test/logs/a.eval": header([
        { name: "match", metrics: { accuracy: 0.5 } },
      ]),
      "/test/logs/sub/b.eval": header([
        { name: "model_graded", metrics: { accuracy: 0.7, grade: "I" } },
      ]),
    };
    await writeDetailed(headers);
    // A previewed row without a header contributes nothing.
    await databaseService.writeLogPreviews({
      "/test/logs/c.json": preview({ task_id: "t-c" }),
    });

    const facts = await readLogsColumnFacts("/test/logs");

    expect(facts.scorerMap).toEqual(
      computeScorerMap(
        Object.entries(headers).map(
          ([name, h]) => ({ name, header: h }) as unknown as Log
        )
      )
    );
    expect(facts.scorerMap["model_graded/grade"]?.valueType).toBe("string");
    expect(facts.hasSampleLimits).toBe(false);
  });

  test("scopeDir membership is the subtree, boundary-safe", async () => {
    await writeDetailed({
      "/test/logs/sub/nested/a.eval": header([
        { name: "nested", metrics: { accuracy: 1 } },
      ]),
      "/test/logs/sub2/b.eval": header([
        { name: "sibling", metrics: { f1: 1 } },
      ]),
    });

    const facts = await readLogsColumnFacts("/test/logs", "/test/logs/sub");

    // Nested subfolders contribute (subtree, not the listing's
    // direct-children membership); the prefix-sharing sibling doesn't.
    expect(Object.keys(facts.scorerMap)).toEqual(["nested/accuracy"]);
  });

  test("retried runs contribute scorers even though the listing hides them", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_task.json": preview({ task_id: "shared" }),
      "/test/logs/2024-01-02_task.json": preview({ task_id: "shared" }),
    });
    await writeDetailed({
      "/test/logs/2024-01-01_task.json": header([
        { name: "old_scorer", metrics: { accuracy: 1 } },
      ]),
      "/test/logs/2024-01-02_task.json": header([
        { name: "new_scorer", metrics: { accuracy: 1 } },
      ]),
    });

    const facts = await readLogsColumnFacts("/test/logs");

    expect(Object.keys(facts.scorerMap).sort()).toEqual([
      "new_scorer/accuracy",
      "old_scorer/accuracy",
    ]);
  });

  test("hasSampleLimits reflects only in-scope logs", async () => {
    await writeDetailed({
      "/test/logs/sub/a.eval": header([], ["time"]),
      "/test/logs/sub2/b.eval": header([]),
    });

    expect((await readLogsColumnFacts("/test/logs")).hasSampleLimits).toBe(
      true
    );
    expect(
      (await readLogsColumnFacts("/test/logs", "/test/logs/sub"))
        .hasSampleLimits
    ).toBe(true);
    expect(
      (await readLogsColumnFacts("/test/logs", "/test/logs/sub2"))
        .hasSampleLimits
    ).toBe(false);
  });
});

describe("readSamplesLogFacts", () => {
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

  test("membership is the retried-hidden subtree, boundary-safe", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/sub/a.json": preview({ task_id: "t-a" }),
      // Same parent dir + task_id: the older run is retried.
      "/test/logs/sub/2024-01-01_x.json": preview({ task_id: "shared" }),
      "/test/logs/sub/2024-01-02_x.json": preview({ task_id: "shared" }),
      // Prefix-sharing sibling directory: not in scope.
      "/test/logs/sub2/c.json": preview({ task_id: "t-c" }),
    });

    const hidden = await readSamplesLogFacts("/test/logs", "/test/logs/sub", {
      showRetriedLogs: false,
    });
    expect(hidden.fileNames.sort()).toEqual([
      "/test/logs/sub/2024-01-02_x.json",
      "/test/logs/sub/a.json",
    ]);
    expect(hidden.retriedCount).toBe(1);
    expect(hidden.taskIds.sort()).toEqual(["shared", "t-a"]);

    const shown = await readSamplesLogFacts("/test/logs", "/test/logs/sub", {
      showRetriedLogs: true,
    });
    expect(shown.fileNames).toHaveLength(3);
    // The toggle's visibility must not depend on the toggle's state.
    expect(shown.retriedCount).toBe(1);
  });

  test("completedCount counts settled logs only (no status ≠ completed)", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task_id: "t-a", status: "success" }),
      "/test/logs/b.json": preview({ task_id: "t-b", status: "started" }),
      "/test/logs/c.json": preview({ task_id: "t-c", status: "error" }),
    });
    // Listed-only row: no preview yet, so no status — in the membership,
    // but neither started nor completed.
    await databaseService.writeLogs([{ name: "/test/logs/d.json" }]);

    const facts = await readSamplesLogFacts("/test/logs", "/test/logs", {
      showRetriedLogs: false,
    });

    expect(facts.fileNames).toHaveLength(4);
    expect(facts.completedCount).toBe(2);
    // The listed-only row has no task_id and must not contribute one.
    expect(facts.taskIds.sort()).toEqual(["t-a", "t-b", "t-c"]);
    expect(facts.retriedCount).toBe(0);
  });

  test("a retried-hidden log's task id still counts via its surviving run", async () => {
    // Retried pairs share a task_id: hiding the older run must not remove
    // the task from the anti-join input (its newest run still carries it).
    await databaseService.writeLogPreviews({
      "/test/logs/2024-01-01_x.json": preview({
        task_id: "shared",
        status: "success",
      }),
      "/test/logs/2024-01-02_x.json": preview({
        task_id: "shared",
        status: "started",
      }),
    });

    const facts = await readSamplesLogFacts("/test/logs", "/test/logs", {
      showRetriedLogs: false,
    });

    expect(facts.fileNames).toEqual(["/test/logs/2024-01-02_x.json"]);
    expect(facts.taskIds).toEqual(["shared"]);
    // The surviving run is still running.
    expect(facts.completedCount).toBe(0);
  });
});

describe("LogsListingData.getMatches", () => {
  let databaseService: DatabaseService;

  const createData = (): LogsListingData<LogListingRow> =>
    createLogsListingData({ logDir: "/test/logs", schema });

  beforeEach(async () => {
    databaseService = createDatabaseService();
    holder.service = databaseService;
    await databaseService.openDatabase();
  });

  afterEach(async () => {
    await databaseService.closeDatabase();
    await Dexie.delete(DB_NAME);
  });

  test("overlaps the snapshot build with the match scan (no serialized table reads)", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task: "alpha", task_id: "t-a" }),
      "/test/logs/b.json": preview({ task: "beta", task_id: "t-b" }),
    });
    // Gate every store read: with a cold snapshot both the snapshot build
    // and the match scan need a full table read, and neither depends on the
    // other's result — serializing them doubles per-keystroke match latency.
    const original = databaseService.readLogs.bind(databaseService);
    const release: Array<() => void> = [];
    const readLogsSpy = vi
      .spyOn(databaseService, "readLogs")
      .mockImplementation(
        (...args) =>
          new Promise((resolve) => {
            release.push(() => resolve(original(...args)));
          })
      );

    const pending = createData().getMatches(undefined, undefined, {
      pageSize: 2,
      term: "alpha",
      searchColumns: ["name", "task"],
    });

    // Both reads must be in flight before either resolves.
    await vi.waitFor(() => expect(readLogsSpy).toHaveBeenCalledTimes(2));
    release.forEach((releaseRead) => releaseRead());

    const matches = await pending;
    expect(matches.map((match) => match.id)).toEqual(["/test/logs/a.json"]);
  });

  test("returns matching row ids and snapshot offsets under the active filter", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task: "alpha", task_id: "t-a" }),
      "/test/logs/b.json": preview({
        task: "beta",
        task_id: "t-b",
        model: "gpt-4o",
      }),
      "/test/logs/c.json": preview({ task: "alphabet", task_id: "t-c" }),
      // Text matches the term but the filter excludes it: matches must
      // respect the same filter as the row query.
      "/test/logs/d.json": preview({
        task: "alpha",
        task_id: "t-d",
        model: "claude",
      }),
    });

    const filter = new Column("model").ilike("gpt%");
    const orderBy = [{ column: "name", direction: "DESC" as const }];
    const matches = await createData().getMatches(filter, orderBy, {
      pageSize: 2,
      // Matching is case-insensitive over the schema's search text.
      term: "ALPHA",
      searchColumns: ["name", "task"],
    });

    expect(matches).toEqual([
      {
        id: "/test/logs/c.json",
        offset: 0,
        orderValues: { name: "c.json" },
      },
      {
        id: "/test/logs/a.json",
        offset: 2,
        orderValues: { name: "a.json" },
      },
    ]);
  });

  test("keeps match offsets tied to the cached page snapshot", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/b.json": preview({ task: "match", task_id: "t-b" }),
      "/test/logs/c.json": preview({ task: "match", task_id: "t-c" }),
    });
    const orderBy = [{ column: "name", direction: "ASC" as const }];

    const data = createData();
    await data.getPage(undefined, orderBy, {
      cursor: null,
      direction: "forward",
      limit: 1,
    });
    // No invalidation: the new leading row is not part of the page
    // snapshot, so it must not shift or join the match projection.
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task: "match", task_id: "t-a" }),
    });

    const matches = await data.getMatches(undefined, orderBy, {
      pageSize: 1,
      term: "match",
      searchColumns: ["task"],
    });
    expect(matches).toEqual([
      {
        id: "/test/logs/b.json",
        offset: 0,
        orderValues: { name: "b.json" },
      },
      {
        id: "/test/logs/c.json",
        offset: 1,
        orderValues: { name: "c.json" },
      },
    ]);
  });

  test("per-term match queries reuse one scan; an epoch bump rescans", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task: "alpha", task_id: "t-a" }),
      "/test/logs/b.json": preview({ task: "beta", task_id: "t-b" }),
    });
    const readLogsSpy = vi.spyOn(databaseService, "readLogs");
    const query = (term: string) => ({
      pageSize: 10,
      term,
      searchColumns: ["task"],
    });

    // Only the `.includes(term)` pass depends on the term: the store scan,
    // retried grouping, and offset map are cached beside the snapshot, so a
    // debounced keystroke sequence must not pay a full scan per term.
    const data = createData();
    const first = await data.getMatches(undefined, undefined, query("alpha"));
    expect(first.map((match) => match.id)).toEqual(["/test/logs/a.json"]);
    expect(readLogsSpy).toHaveBeenCalledTimes(2); // snapshot + match scan

    const second = await data.getMatches(undefined, undefined, query("beta"));
    expect(second.map((match) => match.id)).toEqual(["/test/logs/b.json"]);
    expect(readLogsSpy).toHaveBeenCalledTimes(2);

    // A replication write bumps the epoch: the cached scan must not serve
    // stale rows to the next keystroke.
    await databaseService.writeLogPreviews({
      "/test/logs/c.json": preview({ task: "beta-two", task_id: "t-c" }),
    });
    bumpLogsListingEpoch();
    const rescanned = await data.getMatches(
      undefined,
      undefined,
      query("beta")
    );
    expect(rescanned.map((match) => match.id).sort()).toEqual([
      "/test/logs/b.json",
      "/test/logs/c.json",
    ]);
    expect(readLogsSpy.mock.calls.length).toBeGreaterThan(2);
  });

  test("a failed match scan is not cached as a durable empty result", async () => {
    await databaseService.writeLogPreviews({
      "/test/logs/a.json": preview({ task: "alpha", task_id: "t-a" }),
    });
    const query = { pageSize: 10, term: "alpha", searchColumns: ["task"] };

    // `readLogs` swallowing a store error to null rejects the scan (see
    // scanRows); the cache must evict the rejected build so the next
    // keystroke retries instead of serving "no matches" forever.
    vi.spyOn(databaseService, "readLogs").mockResolvedValue(null);
    const data = createData();
    await expect(data.getMatches(undefined, undefined, query)).rejects.toThrow(
      /listing/i
    );

    vi.restoreAllMocks();
    const recovered = await data.getMatches(undefined, undefined, query);
    expect(recovered.map((match) => match.id)).toEqual(["/test/logs/a.json"]);
  });
});
