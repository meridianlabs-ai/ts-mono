import { describe, expect, it } from "vitest";

import {
  emptyDataframeState,
  normalizeDataframeState,
  normalizeDataframeStates,
} from "./dataframeState";

describe("saved dataframe state", () => {
  it("migrates layout, compound date filters and multisort without mutating storage", () => {
    const raw = {
      columnOrder: {
        orderedColIds: ["0", "value", "transcript_id", "missing"],
      },
      columnSizing: { columnSizingModel: [{ colId: "value", width: 245 }] },
      columnPinning: { leftColIds: ["0", "value"], rightColIds: [] },
      sort: {
        sortModel: [
          { colId: "value", sort: "asc" },
          { colId: "transcript_id", sort: "desc" },
        ],
      },
      scroll: { top: 180, left: 75 },
      filter: {
        filterModel: {
          timestamp: {
            filterType: "date",
            operator: "AND",
            condition1: {
              type: "greaterThan",
              dateFrom: "2024-01-01 00:00:00",
            },
            condition2: { type: "lessThan", dateFrom: "2024-02-01 00:00:00" },
          },
        },
      },
    };
    const before = structuredClone(raw);
    const result = normalizeDataframeState(raw);
    expect(result).toEqual({
      columnOrder: ["0", "value", "transcript_id", "missing"],
      columnSizing: { value: 245 },
      columnPinning: { start: ["0", "value"], end: [] },
      sorting: [
        { id: "value", desc: false },
        { id: "transcript_id", desc: true },
      ],
      scroll: { top: 180, left: 75 },
      columnFilters: {
        timestamp: {
          columnId: "timestamp",
          filterType: "date",
          spec: {
            operator: ">",
            value: "2024-01-01",
            join: "and",
            second: { operator: "<", value: "2024-02-01" },
          },
        },
      },
    });
    expect(normalizeDataframeState(result)).toEqual(result);
    expect(raw).toEqual(before);
  });

  it("drops malformed saved entries while preserving usable preferences", () => {
    expect(
      normalizeDataframeState({
        sorting: [null, { id: 12, desc: "yes" }, { id: "value", desc: true }],
        columnSizing: {
          negative: -1,
          infinite: Infinity,
          string: "10",
          value: 240,
        },
        columnOrder: [null, "value"],
        columnFilters: { bad: { spec: { operator: "bad" } } },
        scroll: { top: -50, left: "no" },
      })
    ).toEqual({
      ...emptyDataframeState,
      sorting: [{ id: "value", desc: true }],
      columnSizing: { value: 240 },
      columnOrder: ["value"],
    });
    expect(normalizeDataframeState(null)).toEqual(emptyDataframeState);
    expect(normalizeDataframeStates(["wrong"])).toEqual({});
  });

  it("keeps zero-valued bounds in legacy numeric range filters", () => {
    expect(
      normalizeDataframeState({
        filter: {
          filterModel: {
            value: {
              filterType: "number",
              type: "inRange",
              filter: 0,
              filterTo: 10,
            },
          },
        },
      }).columnFilters.value?.spec
    ).toEqual({ operator: "between", value: "0", value2: "10" });
  });
});
