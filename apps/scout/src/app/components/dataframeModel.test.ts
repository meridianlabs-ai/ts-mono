import { describe, expect, it } from "vitest";

import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";
import { centerTruncate } from "@tsmono/util";

import {
  compareDataframeValues,
  dataframeCsv,
  dataframeFilterType,
  formatDataframeValue,
  matchesDataframeFilter,
} from "./dataframeModel";

describe("dataframe values and export", () => {
  it("quotes commas, embedded quotes and newlines and exports displayed values", () => {
    expect(
      dataframeCsv(
        [
          {
            text: 'one,"two"\nthree',
            bool: false,
            object: { nested: [1, 2] },
            nil: null,
            missing: undefined,
          },
        ],
        ["text", "bool", "object", "nil", "missing"]
      )
    ).toBe(
      '"text","bool","object","nil","missing"\r\n"one,""two""\nthree","false","{""nested"":[1,2]}","null","undefined"'
    );
    expect(dataframeCsv([], ["text"])).toBe('"text"');
    expect(dataframeCsv([{ text: "hello" }], [])).toBe("");
  });

  it("truncates display and CSV consistently, keeping the raw value available", () => {
    const raw = "start" + "x".repeat(2000) + "end";
    const expected = centerTruncate(raw, 1024);
    expect(formatDataframeValue(raw)).toBe(expected);
    expect(dataframeCsv([{ text: raw }], ["text"])).toBe(
      `"text"\r\n"${expected}"`
    );
  });

  it("sorts numbers numerically, nulls first, dates chronologically, and objects by JSON", () => {
    expect(
      [10, null, -4, 2, undefined, 100].sort(compareDataframeValues)
    ).toEqual([null, -4, 2, 10, 100, undefined]);
    expect(compareDataframeValues(undefined, 1)).toBe(-1);
    expect(
      compareDataframeValues(new Date("2024-01-02"), new Date("2024-01-01"))
    ).toBe(1);
    expect(compareDataframeValues({ score: 2 }, { score: 1 })).toBe(1);
    expect(compareDataframeValues("A", "a")).toBe(-1);
    expect(compareDataframeValues(false, true)).toBe(-1);
  });
});

describe("dataframe type and filter edges", () => {
  it("infers after nulls and recognizes ISO date columns", () => {
    expect(dataframeFilterType([{ value: null }, { value: 10 }], "value")).toBe(
      "number"
    );
    expect(
      dataframeFilterType([{ value: "2024-01-01T12:00:00Z" }], "value")
    ).toBe("date");
    expect(dataframeFilterType([{ value: false }], "value")).toBe("string");
    expect(dataframeFilterType([], "value")).toBe("string");
  });

  it("treats whitespace as blank without trimming text comparisons", () => {
    const filter: ColumnFilter = {
      columnId: "value",
      filterType: "string",
      spec: { operator: "is blank", value: "" },
    };
    expect(matchesDataframeFilter(" \n ", filter)).toBe(true);
    expect(
      matchesDataframeFilter(" alpha ", {
        ...filter,
        spec: { operator: "=", value: "alpha" },
      })
    ).toBe(false);
  });

  it("compares dates at local midnight while preserving timestamp times", () => {
    const filter: ColumnFilter = {
      columnId: "timestamp",
      filterType: "date",
      spec: { operator: "=", value: "2024-01-02" },
    };
    expect(matchesDataframeFilter(new Date(2024, 0, 2), filter)).toBe(true);
    expect(matchesDataframeFilter(new Date(2024, 0, 2, 12), filter)).toBe(
      false
    );
    expect(matchesDataframeFilter(null, filter)).toBe(false);
    expect(matchesDataframeFilter("invalid", filter)).toBe(false);
  });
});
