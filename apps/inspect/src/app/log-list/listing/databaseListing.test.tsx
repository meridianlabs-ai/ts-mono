import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { Column } from "@tsmono/inspect-common/query";
import type { Condition } from "@tsmono/inspect-common/query";

import type { DatabaseListingPlan } from "../../../client/database/listing";
import type { LogListingRow } from "../../../log_data";

import { useDatabaseLogsListingQuery } from "./useLogsListingQuery";

interface Row {
  name: string;
  model: string;
  [k: string]: unknown;
}

type ReadListing = <TRow>(
  logDir: string,
  prefix: string,
  toRow: (log: LogListingRow) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>
) => Promise<{
  items: TRow[];
  total_count: number;
  next_cursor: null;
}>;

const holder = vi.hoisted(() => ({
  records: [] as { name: string; model?: string }[],
  read: vi.fn(),
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
  readLogsListing: (
    ...args: Parameters<ReadListing>
  ): ReturnType<ReadListing> => holder.read(...args) as ReturnType<ReadListing>,
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
    // The seam double: run the plan over the fake records like
    // readLogsListing runs it over the scanned rows.
    holder.read.mockImplementation(
      (
        _logDir: string,
        _prefix: string,
        rowFor: (log: LogListingRow) => Row | undefined,
        plan: DatabaseListingPlan<Row>
      ) => {
        const rows = holder.records
          .map((record) => rowFor(record as LogListingRow))
          .filter((row): row is Row => row !== undefined)
          .filter(plan.matches);
        if (plan.compare) rows.sort(plan.compare);
        return Promise.resolve({
          items: rows,
          total_count: rows.length,
          next_cursor: null,
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

    expect(result.current.loading).toBe(true);
    await waitFor(() =>
      expect(result.current.data?.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
      ])
    );
    expect(result.current.loading).toBe(false);
  });

  test("queries the seam even without an active filter", async () => {
    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );

    // Source (listing) order is preserved when no sort is active.
    await waitFor(() =>
      expect(result.current.data?.items.map((row) => row.name)).toEqual([
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
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
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
      expect(result.current.data?.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
      ])
    );

    // Re-filter: the prior page keeps showing (no pending flash) until the
    // new read lands.
    rerender(listingParams({ filter: new Column("model").eq("claude") }));
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.items.map((row) => row.name)).toEqual([
      "/logs/a.eval",
    ]);
    await waitFor(() =>
      expect(result.current.data?.items.map((row) => row.name)).toEqual([
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
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(holder.read).toHaveBeenCalledTimes(1);

    // The scorer schema arriving changes what the plan computes without any
    // other query input changing — same universe, so the previous rows keep
    // showing while the re-evaluated read is in flight.
    rerender(listingParams({ accessorsKey: "grader/accuracy:number" }));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeDefined();
    await waitFor(() => expect(holder.read).toHaveBeenCalledTimes(2));
  });

  test("surfaces a failed read as an error, not an empty listing", async () => {
    holder.read.mockRejectedValue(new Error("scan failed"));
    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.message).toBe("scan failed");
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  test("does not serve one universe's rows to another", async () => {
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery<Row>(props),
      {
        wrapper,
        initialProps: listingParams({ universe: "logs::/logs" }),
      }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());

    // A different universe (e.g. the flat tasks view at the same prefix)
    // must not show the folder view's rows while its own read is in flight.
    rerender(listingParams({ universe: "tasks::/logs" }));
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBeDefined());
  });
});
