// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Column } from "@tsmono/inspect-common/query";
import type { Condition } from "@tsmono/inspect-common/query";

import type { LogPreview } from "../../../client/api/types";
import { OpenDatabase } from "../../../client/database";
import type { LogListingRow } from "../../../log_data";
import { atRoute, startTestApp, stopTestApp } from "../../../test/testApp";

import {
  useDatabaseLogsListingQuery,
  useLogsListingMatches,
} from "./useLogsListingQuery";

// The hooks read the real listing seam over the local database
// (fake-indexeddb), which a previous session left holding two previewed
// logs: b.eval (claude) and a.eval (gpt-4).

interface Row {
  name: string;
  model: string;
  [k: string]: unknown;
}

const preview = (model: string): LogPreview => ({
  eval_id: `eval-${model}`,
  run_id: `run-${model}`,
  task: "task",
  task_id: `task-${model}`,
  task_version: 1,
  version: 2,
  status: "success",
  error: null,
  model,
  started_at: "2026-01-01T00:00:00Z",
  completed_at: "2026-01-01T01:00:00Z",
});

beforeEach(async () => {
  const db = await OpenDatabase.open();
  await db.writeLogPreviews({
    "/logs/b.eval": preview("claude"),
    "/logs/a.eval": preview("gpt-4"),
  });
  db.close();
  // Directory mode: the fetch engine opens the database the hooks read.
  startTestApp({ logDir: "/logs", singleFileMode: false });
});

afterEach(async () => {
  cleanup();
  await stopTestApp();
  vi.unstubAllGlobals();
});

const wrapper = atRoute();

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
  getValue?: (row: Row, column: string) => unknown;
}) => ({
  filter: overrides?.filter,
  orderBy: overrides?.orderBy,
  getValue: overrides?.getValue ?? getValue,
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

const names = (rows: Row[] | undefined) => rows?.map((row) => row.name);

describe("useDatabaseLogsListingQuery", () => {
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
      expect(names(result.current.data?.items)).toEqual(["/logs/a.eval"])
    );
    expect(result.current.loading).toBe(false);
  });

  test("queries the seam even without an active filter", async () => {
    const { result } = renderHook(
      () => useDatabaseLogsListingQuery<Row>(listingParams()),
      { wrapper }
    );

    // Source (database scan) order is preserved when no sort is active.
    await waitFor(() =>
      expect(names(result.current.data?.items)).toEqual([
        "/logs/b.eval",
        "/logs/a.eval",
      ])
    );
  });

  test("stays disabled (pending) while the universe is hydrating", async () => {
    const { result } = renderHook(
      () => ({
        hydrating: useDatabaseLogsListingQuery<Row>(
          listingParams({ universe: undefined })
        ),
        // A hydrated sibling, so there is a listing the hydrating query
        // could have served.
        hydrated: useDatabaseLogsListingQuery<Row>(listingParams()),
      }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.hydrated.data).toBeDefined());
    expect(result.current.hydrating.loading).toBe(true);
    expect(result.current.hydrating.data).toBeUndefined();
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
      expect(names(result.current.data?.items)).toEqual(["/logs/a.eval"])
    );

    // Re-filter: the prior page keeps showing (no pending flash) until the
    // new read lands.
    rerender(listingParams({ filter: new Column("model").eq("claude") }));
    expect(result.current.loading).toBe(false);
    expect(names(result.current.data?.items)).toEqual(["/logs/a.eval"]);
    await waitFor(() =>
      expect(names(result.current.data?.items)).toEqual(["/logs/b.eval"])
    );
  });

  test("re-queries when the accessor schema lands, keeping the rows as placeholder", async () => {
    // Before the scorer schema lands, the accessor can't read the filtered
    // column; once it lands (a new accessorsKey), the same filter matches.
    const filter = new Column("score").eq(1);
    const withoutSchema = (_row: Row, _column: string): unknown => undefined;
    const withSchema = (row: Row, column: string): unknown =>
      column === "score" ? (row.model === "claude" ? 1 : 0) : row[column];
    const { result, rerender } = renderHook(
      (props) => useDatabaseLogsListingQuery<Row>(props),
      {
        wrapper,
        initialProps: listingParams({
          filter,
          getValue: withoutSchema,
          accessorsKey: "",
        }),
      }
    );
    await waitFor(() => expect(result.current.data?.items).toEqual([]));

    // The schema arriving changes what the plan computes without any other
    // query input changing — same universe, so the previous rows keep
    // showing while the re-evaluated read is in flight.
    rerender(
      listingParams({
        filter,
        getValue: withSchema,
        accessorsKey: "grader/accuracy:number",
      })
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.items).toEqual([]);
    await waitFor(() =>
      expect(names(result.current.data?.items)).toEqual(["/logs/b.eval"])
    );
  });

  test("surfaces a failed read as an error, not an empty listing", async () => {
    // The plan runs inside the read; an accessor that throws fails it.
    // Settle on the first failure rather than after the app's retries.
    vi.stubGlobal("__TEST_DISABLE_RETRY", true);
    const { result } = renderHook(
      () =>
        useDatabaseLogsListingQuery<Row>(
          listingParams({
            filter: new Column("model").eq("gpt-4"),
            getValue: () => {
              throw new Error("scan failed");
            },
          })
        ),
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

describe("useLogsListingMatches", () => {
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
    // Debounce not flushed: no ids for the live term yet, and no
    // "no results" claim may be made.
    expect(result.current.ids).toBeUndefined();
    expect(result.current.settled).toBe(false);

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.ids).toEqual(["/logs/b.eval"]);
  });

  test("keeps the previous term's ids as a placeholder but reports unsettled", async () => {
    const { result, rerender } = renderHook(
      (props) => useLogsListingMatches<Row>(props),
      { wrapper, initialProps: matchesParams({ term: "claude" }) }
    );
    await waitFor(() => expect(result.current.settled).toBe(true));

    // New term: the previous ids keep showing (no flash to empty), but the
    // result must not read as settled — a "no results" gate on pending
    // alone would fire here while the new term's scan is in flight.
    rerender(matchesParams({ term: "zzz" }));
    expect(result.current.ids).toEqual(["/logs/b.eval"]);
    expect(result.current.settled).toBe(false);

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.ids).toEqual([]);
  });

  test("does not serve one universe's ids to another", async () => {
    const { result, rerender } = renderHook(
      (props) => useLogsListingMatches<Row>(props),
      {
        wrapper,
        initialProps: matchesParams({ term: "claude" }),
      }
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.ids).toEqual(["/logs/b.eval"]);

    // Folder-mode ids are basenames, so another scope's ids could mark
    // unrelated same-named rows as matches — they must not carry over.
    rerender(matchesParams({ term: "claude", universe: "tasks::/logs" }));
    expect(result.current.ids).toBeUndefined();
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true));
  });
});
