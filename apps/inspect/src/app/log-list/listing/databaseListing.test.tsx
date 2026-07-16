import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { Column } from "@tsmono/inspect-common/query";

import type { Log } from "../../../client/api/types";
import type {
  DatabaseListingPlan,
  DatabaseListingResult,
} from "../../../client/database/listing";

import { useDatabaseLogsListingQuery } from "./useLogsListingQuery";

interface Row {
  name: string;
  model: string;
}

type ReadListing = (
  scope: unknown,
  syncedPrefix: string,
  toRow: (log: Log) => Row | undefined,
  plan: DatabaseListingPlan<Row>
) => Promise<DatabaseListingResult<Row> | null>;

const holder = vi.hoisted(() => ({
  opened: true,
  read: vi.fn<ReadListing>(),
  invalidate: vi.fn(),
}));

vi.mock("../../../log_data", () => ({
  databaseLogsListingKeyRoot: ["log_data", "dexie-listing", "logs"],
  databaseLogsListingKey: (...parts: unknown[]) => [
    "log_data",
    "dexie-listing",
    "logs",
    ...parts,
  ],
  databaseLogsOpened: () => holder.opened,
  invalidateDatabaseLogsListings: () => {
    holder.invalidate();
  },
  readDatabaseLogsListing: (...args: Parameters<ReadListing>) =>
    holder.read(...args),
}));

const logs = [
  { name: "/logs/a.eval", model: "gpt-4" },
  { name: "/logs/b.eval", model: "claude" },
] as Log[];
const rows: Row[] = logs.map(({ name, model }) => ({ name, model: model! }));
const getValue = (row: Row, column: string): unknown =>
  row[column as keyof Row];

describe("useDatabaseLogsListingQuery", () => {
  let queryClient: QueryClient;
  let getLogsListing: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    holder.read.mockReset();
    holder.invalidate.mockReset();
    getLogsListing = holder.read.mockImplementation(
      (
        _scope: unknown,
        _syncedPrefix: string,
        toRow: (log: Log) => Row | undefined,
        plan: DatabaseListingPlan<Row>
      ): Promise<DatabaseListingResult<Row>> => {
        const items = [...logs]
          .reverse()
          .map(toRow)
          .filter((row): row is Row => row !== undefined)
          .filter(plan.matches);
        if (plan.compare) items.sort(plan.compare);
        return Promise.resolve({
          items,
          total_count: items.length,
          next_cursor: null,
        });
      }
    );
    holder.opened = true;
  });

  test("runs active conditions through the Dexie listing service", async () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useDatabaseLogsListingQuery({
          rows,
          filter: new Column("model").eq("gpt-4"),
          orderBy: [{ column: "name", direction: "ASC" }],
          getValue,
          getComparator: () => undefined,
          database: {
            scope: { prefix: "/logs" },
            syncedPrefix: "/logs",
            view: "logs::/logs",
            rowKey: (row) => row.name,
          },
        }),
      { wrapper }
    );

    await waitFor(() => expect(getLogsListing).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(result.current.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
      ])
    );
  });

  test("keeps the in-memory fallback for scopes that were not persisted", async () => {
    const read = vi.fn().mockResolvedValue(null);
    holder.read.mockImplementation(read);
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useDatabaseLogsListingQuery({
          rows,
          filter: new Column("model").eq("claude"),
          getValue,
          getComparator: () => undefined,
          database: {
            scope: { prefix: "/aliased" },
            syncedPrefix: "/aliased",
            view: "logs::/aliased",
            rowKey: (row) => row.name,
          },
        }),
      { wrapper }
    );

    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(result.current.items.map((row) => row.name)).toEqual([
      "/logs/b.eval",
    ]);
  });

  test("preserves source order when no explicit sort is active", async () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useDatabaseLogsListingQuery({
          rows,
          filter: new Column("model").ilike("%"),
          getValue,
          getComparator: () => undefined,
          database: {
            scope: { prefix: "/logs" },
            syncedPrefix: "/logs",
            view: "logs::/logs",
            rowKey: (row) => row.name,
          },
        }),
      { wrapper }
    );

    await waitFor(() => expect(getLogsListing).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(result.current.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
        "/logs/b.eval",
      ])
    );
  });

  test("refetches against fresh rows when the row set changes without a db write", async () => {
    holder.invalidate.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      queryClient.invalidateQueries({
        queryKey: ["log_data", "dexie-listing", "logs"],
      });
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const makeProps = (viewRows: Row[]) => ({
      rows: viewRows,
      filter: new Column("model").ilike("%"),
      orderBy: [{ column: "name", direction: "ASC" as const }],
      getValue,
      getComparator: () => undefined,
      database: {
        scope: { prefix: "/logs" },
        syncedPrefix: "/logs",
        view: "logs::/logs",
        rowKey: (row: Row) => row.name,
      },
    });
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery(props),
      { wrapper, initialProps: makeProps([rows[0]!]) }
    );
    await waitFor(() =>
      expect(result.current.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
      ])
    );

    // Same view + filter (same query key), new row set with no db write —
    // e.g. a pending task arriving. The hook must invalidate so the cached
    // result isn't served from the old rows.
    rerender(makeProps(rows));
    await waitFor(() => expect(holder.invalidate).toHaveBeenCalled());
    await waitFor(() =>
      expect(result.current.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
        "/logs/b.eval",
      ])
    );
  });

  test("does not serve one view's cached rows to another view at the same prefix", async () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const makeProps = (view: string, viewRows: Row[]) => ({
      rows: viewRows,
      filter: new Column("model").ilike("%"),
      orderBy: [{ column: "name", direction: "ASC" as const }],
      getValue,
      getComparator: () => undefined,
      database: {
        scope: { prefix: "/logs" },
        syncedPrefix: "/logs",
        view,
        rowKey: (row: Row) => row.name,
      },
    });
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery(props),
      { wrapper, initialProps: makeProps("logs::/logs", [rows[0]!]) }
    );
    await waitFor(() =>
      expect(result.current.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
      ])
    );

    // Same prefix + filter, different view: the folder view's cache entry
    // must not leak into the flat view — the synchronous fallback answers
    // until this view's own read lands.
    rerender(makeProps("tasks::/logs", rows));
    expect(result.current.items.map((row) => row.name)).toEqual([
      "/logs/a.eval",
      "/logs/b.eval",
    ]);
    await waitFor(() => expect(getLogsListing).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.items.map((row) => row.name)).toEqual([
        "/logs/a.eval",
        "/logs/b.eval",
      ])
    );
  });
});
