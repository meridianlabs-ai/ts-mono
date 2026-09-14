// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { from } from "arquero";
import { describe, expect, it } from "vitest";

import { createTestWrapper } from "../../test/test-utils";

import { scanResultDataQuery } from "./scanResultQueries";
import { useScanResultSummaries } from "./useScanResultSummaries";

const row = (identifier: string) => ({
  identifier,
  uuid: identifier,
  label: `label-${identifier}`,
  input_type: "transcript",
  value_type: "number",
  value: 1,
  event_references: "[]",
  message_references: "[]",
  transcript_metadata: "{}",
});

describe("useScanResultSummaries", () => {
  it("parses each row of the table into a summary", async () => {
    const table = from([row("r1"), row("r2")]);
    const { result } = renderHook(() => useScanResultSummaries(table), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data.map((s) => s.identifier)).toEqual(["r1", "r2"]);
    expect(result.current.error).toBeNull();
  });

  it("answers immediately with no summaries for an absent or empty table", () => {
    const wrapper = createTestWrapper();
    const absent = renderHook(() => useScanResultSummaries(undefined), {
      wrapper,
    });
    expect(absent.result.current).toEqual({
      data: [],
      isLoading: false,
      error: null,
    });

    const empty = renderHook(() => useScanResultSummaries(from([])), {
      wrapper,
    });
    expect(empty.result.current.isLoading).toBe(false);
    expect(empty.result.current.data).toEqual([]);
  });
});

describe("scanResultDataQuery", () => {
  it("resolves the matching row, and null when no row matches", async () => {
    const table = from([row("r1"), row("r2")]);
    const wrapper = createTestWrapper();

    const hit = renderHook(() => useQuery(scanResultDataQuery(table, "r2")), {
      wrapper,
    });
    await waitFor(() => {
      expect(hit.result.current.isSuccess).toBe(true);
    });
    expect(hit.result.current.data?.identifier).toBe("r2");

    const miss = renderHook(
      () => useQuery(scanResultDataQuery(table, "nope")),
      { wrapper }
    );
    await waitFor(() => {
      expect(miss.result.current.isSuccess).toBe(true);
    });
    expect(miss.result.current.data).toBeNull();
  });

  it("is disabled until both a table and a row identifier exist", () => {
    const table = from([row("r1")]);
    const wrapper = createTestWrapper();
    const noRow = renderHook(
      () => useQuery(scanResultDataQuery(table, undefined)),
      { wrapper }
    );
    const noTable = renderHook(
      () => useQuery(scanResultDataQuery(undefined, "r1")),
      { wrapper }
    );
    expect(noRow.result.current.fetchStatus).toBe("idle");
    expect(noTable.result.current.fetchStatus).toBe("idle");
  });
});
