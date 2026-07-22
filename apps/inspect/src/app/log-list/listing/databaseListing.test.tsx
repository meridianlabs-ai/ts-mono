import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { Column } from "@tsmono/inspect-common/query";
import type { Condition } from "@tsmono/inspect-common/query";

import type { Cursor } from "../../../client/database/listing";
import type {
  LogListingRow,
  LogsListingMatch,
  LogsListingPageQuery,
} from "../../../log_data";

import {
  useDatabaseLogsListingQuery,
  useLogsListingMatches,
} from "./useLogsListingQuery";

interface Row {
  name: string;
  model: string;
  [k: string]: unknown;
}

type ReadListingPage = <TRow>(
  query: LogsListingPageQuery<TRow>,
  page: { cursor?: Cursor | null; limit: number }
) => Promise<{
  items: TRow[];
  total_count: number;
  next_cursor: Cursor | null;
}>;

const holder = vi.hoisted(() => ({
  records: [] as { name: string; model?: string }[],
  read: vi.fn(),
  readMatches: vi.fn(),
}));

vi.mock("../../../log_data", () => ({
  databaseLogsListingKeyRoot: ["log_data", "dexie-listing", "logs"],
  databaseLogsListingKey: (...parts: unknown[]) => [
    "log_data",
    "dexie-listing",
    "logs",
    ...parts.map((part) => part ?? null),
  ],
  listingKeyUniverse: (queryKey: readonly unknown[]) => queryKey[3],
  readLogsListingPage: (
    ...args: Parameters<ReadListingPage>
  ): ReturnType<ReadListingPage> =>
    holder.read(...args) as ReturnType<ReadListingPage>,
  readLogsListingMatches: (...args: unknown[]): Promise<LogsListingMatch[]> =>
    holder.readMatches(...args) as Promise<LogsListingMatch[]>,
}));

const records = [
  { name: "/logs/b.eval", model: "claude" },
  { name: "/logs/a.eval", model: "gpt-4" },
];

const getValue = (row: Row, column: string): unknown => row[column];
const toRow = (log: LogListingRow): Row | undefined =>
  log.model === undefined
    ? undefined
    : { name: log.name, model: log.model ?? "" };

const listingParams = (overrides?: {
  filter?: Condition;
  orderBy?: { column: string; direction: "ASC" | "DESC" }[];
  universe?: string | undefined;
  accessorsKey?: string;
}) => ({
  filter: overrides?.filter,
  orderBy: overrides?.orderBy,
  getValue,
  getComparator: () => undefined,
  accessorsKey: overrides?.accessorsKey ?? "",
  listing: {
    logDir: "/logs",
    prefix: "/logs",
    universe:
      overrides && "universe" in overrides ? overrides.universe : "logs::/logs",
    toRow,
  },
});

describe("useDatabaseLogsListingQuery", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    holder.records = records;
    holder.read.mockReset();
    // The seam double: run the plan over the fake records and slice the
    // requested page, like readLogsListingPage over the snapshot.
    holder.read.mockImplementation(
      (
        query: LogsListingPageQuery<Row>,
        page: { cursor?: Cursor | null; limit: number }
      ) => {
        const rows = holder.records
          .map((record) => query.toRow(record as LogListingRow))
          .filter((row): row is Row => row !== undefined)
          .filter(query.plan.matches);
        if (query.plan.compare) rows.sort(query.plan.compare);
        const offset =
          typeof page.cursor?.offset === "number" ? page.cursor.offset : 0;
        const end = offset + page.limit;
        return Promise.resolve({
          items: rows.slice(offset, end),
          total_count: rows.length,
          next_cursor: end < rows.length ? { offset: end } : null,
        });
      }
    );
  });

  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  test("shapes and queries source records through the listing seam", async () => {
    const { result } = renderHook(
      () =>
        useDatabaseLogsListingQuery<Row>(
          listingParams({
            filter: new Column("model").eq("gpt-4"),
            orderBy: [{ column: "name", direction: "ASC" }],
          })
        ),
      { wrapper }
    );

    expect(result.current.result.loading).toBe(true);
    await waitFor(() =>
      expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
      ])
    );
    expect(result.current.result.loading).toBe(false);
  });

  test("queries the seam even without an active filter", async () => {
    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );

    // Source (listing) order is preserved when no sort is active.
    await waitFor(() =>
      expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
        "/logs/b.eval",
        "/logs/a.eval",
      ])
    );
  });

  test("stays disabled (pending) while the universe is hydrating", async () => {
    const { result } = renderHook(
      () =>
        useDatabaseLogsListingQuery<Row>(
          listingParams({ universe: undefined })
        ),
      { wrapper }
    );

    await Promise.resolve();
    expect(holder.read).not.toHaveBeenCalled();
    expect(result.current.result.loading).toBe(true);
    expect(result.current.result.data).toBeUndefined();
  });

  test("keeps the previous result across re-filters within one universe", async () => {
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery<Row>(props),
      {
        wrapper,
        initialProps: listingParams({
          filter: new Column("model").eq("gpt-4"),
        }),
      }
    );
    await waitFor(() =>
      expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
      ])
    );

    // Re-filter: the prior page keeps showing (no pending flash) until the
    // new read lands.
    rerender(listingParams({ filter: new Column("model").eq("claude") }));
    expect(result.current.result.loading).toBe(false);
    expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
      "/logs/a.eval",
    ]);
    await waitFor(() =>
      expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
        "/logs/b.eval",
      ])
    );
  });

  test("re-queries when the accessor schema lands, keeping the rows as placeholder", async () => {
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery<Row>(props),
      {
        wrapper,
        initialProps: listingParams({ accessorsKey: "" }),
      }
    );
    await waitFor(() => expect(result.current.result.data).toBeDefined());
    expect(holder.read).toHaveBeenCalledTimes(1);

    // The scorer schema arriving changes what the plan computes without any
    // other query input changing — same universe, so the previous rows keep
    // showing while the re-evaluated read is in flight.
    rerender(listingParams({ accessorsKey: "grader/accuracy:number" }));
    expect(result.current.result.loading).toBe(false);
    expect(result.current.result.data).toBeDefined();
    await waitFor(() => expect(holder.read).toHaveBeenCalledTimes(2));
  });

  test("surfaces a failed read as an error, not an empty listing", async () => {
    holder.read.mockRejectedValue(new Error("scan failed"));
    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );

    await waitFor(() => expect(result.current.result.error).toBeDefined());
    expect(result.current.result.error?.message).toBe("scan failed");
    expect(result.current.result.loading).toBe(false);
    expect(result.current.result.data).toBeUndefined();
    expect(result.current.error).toBeDefined();
    // A settled error must pause commit-driven fetch chaining — the grid
    // would otherwise retry the failing request in a tight loop.
    expect(result.current.autoFetchPaused).toBe(true);
  });

  /** Page by 1 regardless of the requested limit so fixtures exercise the
   *  multi-page path without 500+ records. */
  const pageByOne = () =>
    holder.read.mockImplementation(
      (
        query: LogsListingPageQuery<Row>,
        page: { cursor?: Cursor | null; limit: number }
      ) => {
        const rows = holder.records
          .map((record) => query.toRow(record as LogListingRow))
          .filter((row): row is Row => row !== undefined);
        const offset =
          typeof page.cursor?.offset === "number" ? page.cursor.offset : 0;
        const end = offset + 1;
        return Promise.resolve({
          items: rows.slice(offset, end),
          total_count: rows.length,
          next_cursor: end < rows.length ? { offset: end } : null,
        });
      }
    );

  test("accumulates pages via fetchNextPage and reports the universe total", async () => {
    pageByOne();

    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
        "/logs/b.eval",
      ])
    );
    // The footer count covers the whole filtered universe, not loaded rows.
    expect(result.current.result.data?.total_count).toBe(2);
    expect(result.current.hasNextPage).toBe(true);

    result.current.fetchNextPage();
    await waitFor(() =>
      expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
        "/logs/b.eval",
        "/logs/a.eval",
      ])
    );
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.autoFetchPaused).toBe(false);
  });

  test("loads pages through a requested snapshot offset", async () => {
    holder.records = [
      ...records,
      { name: "/logs/c.eval", model: "gpt-5" },
      { name: "/logs/d.eval", model: "gpt-5" },
    ];
    pageByOne();

    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.result.data?.items.length).toBe(1)
    );

    act(() => result.current.ensureOffsetLoaded(2));
    await waitFor(() =>
      expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
        "/logs/b.eval",
        "/logs/a.eval",
        "/logs/c.eval",
      ])
    );
    expect(holder.read).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ cursor: { offset: 2 } })
    );
  });

  test("keeps loading through an offset across query-input identity churn", async () => {
    holder.records = [
      ...records,
      { name: "/logs/c.eval", model: "gpt-5" },
      { name: "/logs/d.eval", model: "gpt-5" },
    ];
    pageByOne();

    const orderBy = () => [{ column: "name", direction: "ASC" as const }];
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery<Row>(props),
      { wrapper, initialProps: listingParams({ orderBy: orderBy() }) }
    );
    await waitFor(() =>
      expect(result.current.result.data?.items.length).toBe(1)
    );

    act(() => result.current.ensureOffsetLoaded(3));
    // A grid-state patch re-derives filter/orderBy with fresh identities but
    // equal values (e.g. persisting a selection as the find band closes) —
    // the pending request is keyed by value, so it must keep chaining.
    rerender(listingParams({ orderBy: orderBy() }));

    await waitFor(() =>
      expect(result.current.result.data?.items.length).toBe(4)
    );
  });

  test("keeps retained rows through a failed read, reporting the error beside them", async () => {
    pageByOne();
    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.result.data?.items.length).toBe(1)
    );
    expect(result.current.error).toBeUndefined();

    // The next read fails (a page fetch here; an invalidation refetch is the
    // same query state) — the loaded rows must keep serving (warm), with the
    // failure reported beside them rather than through the AsyncData.
    holder.read.mockRejectedValue(new Error("scan failed"));
    result.current.fetchNextPage();
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.result.data?.items.map((row) => row.name)).toEqual([
      "/logs/b.eval",
    ]);
    expect(result.current.result.error).toBeUndefined();
    expect(result.current.autoFetchPaused).toBe(true);

    // Recovery: an invalidation refetch (retry banner / write path / sync)
    // that succeeds clears the error and keeps the rows.
    pageByOne();
    await queryClient.invalidateQueries();
    await waitFor(() => expect(result.current.error).toBeUndefined());
    expect(result.current.result.data?.items.length).toBeGreaterThan(0);
    expect(result.current.autoFetchPaused).toBe(false);
  });

  test("deep paging keeps every loaded page — no retained-page cap", async () => {
    // Guards against reintroducing react-query's `maxPages`: it drops pages
    // off the *front*, and with no getPreviousPageParam/scroll-up trigger
    // the head rows would be unrecoverable (see the query options comment).
    const pageCount = 25;
    holder.records = Array.from({ length: pageCount }, (_, i) => ({
      name: `/logs/${String(i).padStart(2, "0")}.eval`,
      model: "claude",
    }));
    pageByOne();

    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.result.data?.items.length).toBe(1)
    );

    for (let pages = 1; pages < pageCount; pages++) {
      result.current.fetchNextPage();
      await waitFor(() =>
        expect(result.current.result.data?.items.length).toBe(pages + 1)
      );
    }

    expect(result.current.result.data?.items[0]?.name).toBe("/logs/00.eval");
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.autoFetchPaused).toBe(false);
  });

  test("does not serve one universe's rows to another", async () => {
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery<Row>(props),
      {
        wrapper,
        initialProps: listingParams({ universe: "logs::/logs" }),
      }
    );
    await waitFor(() => expect(result.current.result.data).toBeDefined());

    // A different universe (e.g. the flat tasks view at the same prefix)
    // must not show the folder view's rows while its own read is in flight.
    rerender(listingParams({ universe: "tasks::/logs" }));
    expect(result.current.result.data).toBeUndefined();
    expect(result.current.result.loading).toBe(true);
    await waitFor(() => expect(result.current.result.data).toBeDefined());
  });
});

describe("useLogsListingMatches", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    holder.records = records;
    holder.readMatches.mockReset();
    // The seam double: lowercase-contains over the shaped records, like
    // readLogsListingMatches over the scanned rows.
    holder.readMatches.mockImplementation(
      (
        query: LogsListingPageQuery<Row>,
        find: {
          pageSize: number;
          term: string;
          getRowId: (row: Row) => string;
          getOrderValue: (row: Row, columnId: string) => unknown;
          rowText: (row: Row) => string;
        }
      ) => {
        const rows = holder.records
          .map((record) => query.toRow(record as LogListingRow))
          .filter((row): row is Row => row !== undefined)
          .filter(query.plan.matches);
        if (query.plan.compare) rows.sort(query.plan.compare);
        return Promise.resolve(
          rows
            .map((row, offset) => ({ row, offset }))
            .filter(({ row }) =>
              find.rowText(row).includes(find.term.toLowerCase())
            )
            .map(({ row, offset }) => {
              const match = { id: find.getRowId(row), offset };
              return query.orderBy?.length
                ? {
                    ...match,
                    orderValues: Object.fromEntries(
                      query.orderBy.map(({ column }) => [
                        column,
                        find.getOrderValue(row, column),
                      ])
                    ),
                  }
                : match;
            })
        );
      }
    );
  });

  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const matchesParams = (overrides?: {
    term?: string;
    enabled?: boolean;
    universe?: string;
  }) => ({
    ...listingParams({ universe: overrides?.universe ?? "logs::/logs" }),
    term: overrides?.term ?? "",
    enabled: overrides?.enabled ?? true,
    getRowId: (row: Row) => row.name,
    rowText: (row: Row) => `${row.name}\n${row.model}`.toLowerCase(),
    searchKey: ["name", "model"],
  });

  test("reports ids as settled only after the debounced term's result lands", async () => {
    const { result, rerender } = renderHook(
      (props) => useLogsListingMatches<Row>(props),
      { wrapper, initialProps: matchesParams() }
    );

    rerender(matchesParams({ term: "claude" }));
    // Debounce not flushed: no matches for the live term yet, and no
    // "no results" claim may be made.
    expect(result.current.matches).toBeUndefined();
    expect(result.current.settled).toBe(false);

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.matches).toEqual([{ id: "/logs/b.eval", offset: 0 }]);
  });

  test("keeps the previous term's matches as a placeholder but reports unsettled", async () => {
    const { result, rerender } = renderHook(
      (props) => useLogsListingMatches<Row>(props),
      { wrapper, initialProps: matchesParams({ term: "claude" }) }
    );
    await waitFor(() => expect(result.current.settled).toBe(true));

    // New term: the previous ids keep showing (no flash to empty), but the
    // result must not read as settled — a "no results" gate on pending
    // alone would fire here while the new term's scan is in flight.
    rerender(matchesParams({ term: "zzz" }));
    expect(result.current.matches).toEqual([{ id: "/logs/b.eval", offset: 0 }]);
    expect(result.current.settled).toBe(false);

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.matches).toEqual([]);
  });

  test("does not serve one universe's matches to another", async () => {
    const { result, rerender } = renderHook(
      (props) => useLogsListingMatches<Row>(props),
      {
        wrapper,
        initialProps: matchesParams({ term: "claude" }),
      }
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.matches).toEqual([{ id: "/logs/b.eval", offset: 0 }]);

    // Folder-mode ids are basenames, so another scope's matches could mark
    // unrelated same-named rows as matches — they must not carry over.
    rerender(matchesParams({ term: "claude", universe: "tasks::/logs" }));
    expect(result.current.matches).toBeUndefined();
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true));
  });
});
