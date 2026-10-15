// @no-unsafe-eval: hosts may serve Scout under a CSP without it.
import { table } from "arquero";
import { describe, expect, it } from "vitest";

import { rowRecords, rowsWhere } from "./arrowCells";

const scans = () =>
  table({
    identifier: ["a", "b", "c"],
    value_type: ["resultset", null, "resultset"],
    value: ["[]", 2, "[]"],
  });

describe("rowRecords", () => {
  it("returns one record per row with every column", () => {
    expect(rowRecords(scans())).toEqual([
      { identifier: "a", value_type: "resultset", value: "[]" },
      { identifier: "b", value_type: null, value: 2 },
      { identifier: "c", value_type: "resultset", value: "[]" },
    ]);
  });

  it("returns no records for an empty table", () => {
    expect(rowRecords(table({ identifier: [] }))).toEqual([]);
  });
});

describe("rowsWhere", () => {
  it("keeps the matching rows, in order, with every column", () => {
    const kept = rowsWhere(scans(), "value_type", (t) => t === "resultset");

    expect(kept.columnNames()).toEqual(["identifier", "value_type", "value"]);
    expect(rowRecords(kept)).toEqual([
      { identifier: "a", value_type: "resultset", value: "[]" },
      { identifier: "c", value_type: "resultset", value: "[]" },
    ]);
  });

  it("keeps the columns when no row matches", () => {
    const kept = rowsWhere(scans(), "identifier", (id) => id === "z");

    expect(kept.numRows()).toBe(0);
    expect(kept.columnNames()).toEqual(["identifier", "value_type", "value"]);
  });

  it("throws for a column the table doesn't have", () => {
    expect(() => rowsWhere(scans(), "missing", () => true)).toThrow(/missing/);
  });
});
