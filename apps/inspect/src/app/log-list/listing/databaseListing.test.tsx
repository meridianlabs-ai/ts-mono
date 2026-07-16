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
});
