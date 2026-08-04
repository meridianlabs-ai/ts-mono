import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { Column } from "@tsmono/inspect-common/query";
import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";

import type {
  LogsListingData,
  LogsListingFindQuery,
  LogsListingMatch,
} from "../../../log_data";
import {
  invalidateDatabaseLogsListings,
  logsListingEpoch,
} from "../../../log_data";
import { queryClient as appQueryClient } from "../../../state/queryClient";

import {
  useDatabaseLogsListingQuery,
  useLogsListingMatches,
} from "./useLogsListingQuery";

interface Row {
  name: string;
  model: string;
  [k: string]: unknown;
}

const holder = vi.hoisted(() => ({
  records: [] as { name: string; model?: string }[],
  read: vi.fn(),
  readMatches: vi.fn(),
}));

// The hooks import the query-key helpers from the barrel; mock it so the
// jsdom test doesn't drag in the whole data layer (dexie et al). The read
// seams themselves are injected through the descriptor's `data` object.
// Everything these tests need (the key helpers, the invalidator under test
// below, and its epoch) lives in two real modules with no storage imports —
// they stand in for the barrel.
vi.mock("../../../log_data", async () => ({
  ...(await vi.importActual("../../../log_data/databaseListings")),
  ...(await vi.importActual("../../../log_data/logsListingEpoch")),
}));

const records = [
  { name: "/logs/b.eval", model: "claude" },
  { name: "/logs/a.eval", model: "gpt-4" },
];

// The seam double evaluates queries itself (the real evaluation lives
// behind the data interface now): equality filters and single-column
// string sorts cover what these tests exercise.
const matchesFilter = (row: Row, filter?: Condition): boolean => {
  if (!filter) return true;
  if (filter.compound || filter.operator !== "=") {
    throw new Error("unsupported filter in the seam double");
  }
  return row[filter.left] === filter.right;
};

const sortRows = (rows: Row[], orderBy?: OrderByModel[]): Row[] => {
  if (!orderBy || orderBy.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const { column, direction } of orderBy) {
      const av = (a[column] as string | undefined) ?? "";
      const bv = (b[column] as string | undefined) ?? "";
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return direction === "DESC" ? -cmp : cmp;
    }
    return 0;
  });
};

const shapedRows = (filter?: Condition, orderBy?: OrderByModel[]): Row[] =>
  sortRows(
    holder.records
      .filter((record) => record.model !== undefined)
      .map((record) => ({ name: record.name, model: record.model ?? "" }))
      .filter((row) => matchesFilter(row, filter)),
    orderBy
  );

const fakeData: LogsListingData<Row> = {
  getPage: (filter, orderBy, pagination) =>
    holder.read(filter, orderBy, pagination) as ReturnType<
      LogsListingData<Row>["getPage"]
    >,
  getMatches: (filter, orderBy, find) =>
    holder.readMatches(filter, orderBy, find) as Promise<LogsListingMatch[]>,
  getOverview: () => {
    throw new Error("not used by these hooks");
  },
};

const listingParams = (overrides?: {
  filter?: Condition;
  orderBy?: { column: string; direction: "ASC" | "DESC" }[];
  scopeKey?: string | undefined;
  accessorsKey?: string;
}) => ({
  filter: overrides?.filter,
  orderBy: overrides?.orderBy,
  accessorsKey: overrides?.accessorsKey ?? "",
  listing: {
    scopeKey:
      overrides && "scopeKey" in overrides ? overrides.scopeKey : "logs::/logs",
    data: fakeData,
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
    // The seam double: evaluate the query over the fake records and slice
    // the requested page, like getPage over the snapshot.
    holder.read.mockImplementation(
      (
        filter: Condition | undefined,
        orderBy: OrderByModel[] | undefined,
        pagination: Pagination
      ) => {
        const rows = shapedRows(filter, orderBy);
        const offset =
          typeof pagination.cursor?.offset === "number"
            ? pagination.cursor.offset
            : 0;
        const end = offset + pagination.limit;
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

  test("passes the page's universe task ids through the flattened result", async () => {
    holder.read.mockImplementation(() =>
      Promise.resolve({
        items: [],
        total_count: 0,
        next_cursor: null,
        universe_task_ids: ["t-1", "t-2"],
      })
    );
    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.result.data?.universe_task_ids).toEqual([
        "t-1",
        "t-2",
      ])
    );
  });

  test("stays disabled (pending) while the scopeKey is hydrating", async () => {
    const { result } = renderHook(
      () =>
        useDatabaseLogsListingQuery<Row>(
          listingParams({ scopeKey: undefined })
        ),
      { wrapper }
    );

    await Promise.resolve();
    expect(holder.read).not.toHaveBeenCalled();
    expect(result.current.result.loading).toBe(true);
    expect(result.current.result.data).toBeUndefined();
  });

  test("keeps the previous result across re-filters within one scopeKey", async () => {
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
    // other query input changing — same scopeKey, so the previous rows keep
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
        filter: Condition | undefined,
        orderBy: OrderByModel[] | undefined,
        pagination: Pagination
      ) => {
        const rows = shapedRows(filter, orderBy);
        const offset =
          typeof pagination.cursor?.offset === "number"
            ? pagination.cursor.offset
            : 0;
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
      undefined,
      undefined,
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

  test("does not serve one scopeKey's rows to another", async () => {
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery<Row>(props),
      {
        wrapper,
        initialProps: listingParams({ scopeKey: "logs::/logs" }),
      }
    );
    await waitFor(() => expect(result.current.result.data).toBeDefined());

    // A different scope (e.g. the flat tasks view at the same dir)
    // must not show the folder view's rows while its own read is in flight.
    rerender(listingParams({ scopeKey: "tasks::/logs" }));
    expect(result.current.result.data).toBeUndefined();
    expect(result.current.result.loading).toBe(true);
    await waitFor(() => expect(result.current.result.data).toBeDefined());
  });
});

describe("invalidateDatabaseLogsListings", () => {
  // These drive the real serialized invalidation loop against the app's
  // queryClient singleton, so the shipped semantics are what's under test:
  // an invalidation must not demote an in-flight fetchNextPage; a write
  // landing during a fetch must still be exposed by a catch-up round; and
  // the snapshot epoch must never advance mid-refetch (spliced orderings).
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={appQueryClient}>
      {children}
    </QueryClientProvider>
  );

  /** Page-by-one seam with a one-shot gate on the next `offset > 0` read
   *  (armed explicitly, so initial loads run ungated). `rowsForRead`
   *  resolves the row set AFTER the gate — the adversarial order for the
   *  epoch-coherence test. */
  const gatedPageByOne = (rowsForRead: () => Row[]) => {
    let armed = false;
    let release: (() => void) | undefined;
    holder.read.mockReset();
    holder.read.mockImplementation(
      async (
        _filter: Condition | undefined,
        _orderBy: OrderByModel[] | undefined,
        pagination: Pagination
      ) => {
        const offset =
          typeof pagination.cursor?.offset === "number"
            ? pagination.cursor.offset
            : 0;
        if (offset > 0 && armed) {
          armed = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        const rows = rowsForRead();
        const end = offset + 1;
        return {
          items: rows.slice(offset, end),
          total_count: rows.length,
          next_cursor: end < rows.length ? { offset: end } : null,
        };
      }
    );
    return {
      armGate: () => {
        armed = true;
      },
      gateBlocked: () => release !== undefined,
      releaseGate: () => {
        release?.();
        release = undefined;
      },
    };
  };

  /** Flush the throttled kick and let the loop drain before restoring real
   *  timers — a trailing throttle timer discarded by `useRealTimers` would
   *  wedge the module-level throttle for later tests. */
  const settleInvalidationLoop = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await waitFor(() => expect(appQueryClient.isFetching()).toBe(0));
  };

  test("an invalidation landing mid-fetchNextPage does not discard the page", async () => {
    // The loop never cancels an in-flight fetch: with react-query's default
    // cancelRefetch the next-page fetch was canceled and restarted as a
    // refetch of the loaded pages — at scale (writes ~1/s, refetch cycles
    // slower) every next-page fetch got demoted and pagination stalled.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      holder.records = records;
      const gate = gatedPageByOne(() => shapedRows());

      const { result } = renderHook(
        () => useDatabaseLogsListingQuery<Row>(listingParams()),
        { wrapper }
      );
      await waitFor(() =>
        expect(result.current.result.data?.items.length).toBe(1)
      );

      gate.armGate();
      result.current.fetchNextPage();
      await waitFor(() => expect(gate.gateBlocked()).toBe(true));

      // The throttled kick fires while page 2 is still in flight; the loop
      // must wait, not cancel.
      invalidateDatabaseLogsListings();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      act(() => gate.releaseGate());
      await waitFor(() =>
        expect(
          result.current.result.data?.items.map((row) => row.name)
        ).toEqual(["/logs/b.eval", "/logs/a.eval"])
      );
      await settleInvalidationLoop();
    } finally {
      vi.useRealTimers();
      appQueryClient.clear();
    }
  });

  test("a write landing mid-fetch is exposed by an automatic catch-up round", async () => {
    // The skipped-refetch hole of bare cancelRefetch: false — the old fetch's
    // success cleared the invalidated mark and, with no later write, the
    // listing stayed stale indefinitely. The dirty loop must refetch after
    // the in-flight page settles, with no further write, filter change, or
    // manual invalidation.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      holder.records = records;
      const gate = gatedPageByOne(() => shapedRows());

      const { result } = renderHook(
        () => useDatabaseLogsListingQuery<Row>(listingParams()),
        { wrapper }
      );
      await waitFor(() =>
        expect(result.current.result.data?.items.length).toBe(1)
      );

      gate.armGate();
      result.current.fetchNextPage();
      await waitFor(() => expect(gate.gateBlocked()).toBe(true));

      // The backing rows advance to snapshot B while page 2 (snapshot A) is
      // in flight, and the write invalidates.
      holder.records = [...records, { name: "/logs/c.eval", model: "claude" }];
      invalidateDatabaseLogsListings();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      act(() => gate.releaseGate());
      // The in-flight page lands un-demoted...
      await waitFor(() =>
        expect(
          result.current.result.data?.items.map((row) => row.name)
        ).toEqual(["/logs/b.eval", "/logs/a.eval"])
      );
      // ...and the loop's catch-up round exposes B on its own.
      await waitFor(() =>
        expect(result.current.result.data?.total_count).toBe(3)
      );
      expect(result.current.hasNextPage).toBe(true);
      await settleInvalidationLoop();
    } finally {
      vi.useRealTimers();
      appQueryClient.clear();
    }
  });

  test("an invalidation during a multi-page refetch never splices orderings", async () => {
    // Reads snapshot per epoch (mirroring the real data layer): if the loop
    // bumped the epoch mid-refetch, the still-running pass would serve later
    // pages from the re-ordered snapshot — duplicate/missing rows in one
    // committed window. The loop must defer the bump to its next round.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      holder.records = [
        { name: "/logs/r1.eval", model: "m" },
        { name: "/logs/r2.eval", model: "m" },
        { name: "/logs/r3.eval", model: "m" },
        { name: "/logs/r4.eval", model: "m" },
      ];
      const snapshots = new Map<number, Row[]>();
      const epochRows = () => {
        const epoch = logsListingEpoch();
        let rows = snapshots.get(epoch);
        if (rows === undefined) {
          rows = shapedRows();
          snapshots.set(epoch, rows);
        }
        return rows;
      };
      const gate = gatedPageByOne(epochRows);

      const history: string[][] = [];
      const { result } = renderHook(
        () => {
          const query = useDatabaseLogsListingQuery<Row>(listingParams());
          const items = query.result.data?.items;
          if (items) {
            const names = items.map((row) => row.name);
            if (history.at(-1)?.join() !== names.join()) {
              history.push(names);
            }
          }
          return query;
        },
        { wrapper }
      );
      await waitFor(() =>
        expect(result.current.result.data?.items.length).toBe(1)
      );
      result.current.fetchNextPage();
      await waitFor(() =>
        expect(result.current.result.data?.items.length).toBe(2)
      );

      // A write triggers a refetch of the two retained pages; page 2 of the
      // refetch blocks mid-pass.
      gate.armGate();
      invalidateDatabaseLogsListings();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      await waitFor(() => expect(gate.gateBlocked()).toBe(true));

      // Mid-refetch: the backing rows re-order and another write lands.
      holder.records = [...holder.records].reverse();
      invalidateDatabaseLogsListings();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      act(() => gate.releaseGate());
      // The loop's follow-up round exposes the new ordering...
      await waitFor(() =>
        expect(
          result.current.result.data?.items.map((row) => row.name)
        ).toEqual(["/logs/r4.eval", "/logs/r3.eval"])
      );
      // ...and no committed window ever mixed the two orderings.
      for (const names of history) {
        expect(new Set(names).size).toBe(names.length);
      }
      await settleInvalidationLoop();
    } finally {
      vi.useRealTimers();
      appQueryClient.clear();
    }
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
    // The seam double: lowercase-contains over the search columns' raw
    // values, like getMatches over the schema's per-column search text.
    holder.readMatches.mockImplementation(
      (
        filter: Condition | undefined,
        orderBy: OrderByModel[] | undefined,
        find: LogsListingFindQuery
      ) => {
        const rows = shapedRows(filter, orderBy);
        const rowText = (row: Row): string =>
          find.searchColumns
            .map((columnId) => (row[columnId] as string | undefined) ?? "")
            .join("\n")
            .toLowerCase();
        return Promise.resolve(
          rows
            .map((row, offset) => ({ row, offset }))
            .filter(({ row }) => rowText(row).includes(find.term.toLowerCase()))
            .map(({ row, offset }) => {
              const match = { id: row.name, offset };
              return orderBy?.length
                ? {
                    ...match,
                    orderValues: Object.fromEntries(
                      orderBy.map(({ column }) => [column, row[column]])
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
    scopeKey?: string;
  }) => ({
    ...listingParams({ scopeKey: overrides?.scopeKey ?? "logs::/logs" }),
    term: overrides?.term ?? "",
    enabled: overrides?.enabled ?? true,
    searchColumns: ["name", "model"],
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

  test("does not serve one scopeKey's matches to another", async () => {
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
    rerender(matchesParams({ term: "claude", scopeKey: "tasks::/logs" }));
    expect(result.current.matches).toBeUndefined();
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true));
  });
});
