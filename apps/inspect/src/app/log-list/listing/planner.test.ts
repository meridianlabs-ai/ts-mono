import { describe, expect, it } from "vitest";

import { Column } from "@tsmono/inspect-common/query";
import type { FilterType } from "@tsmono/inspect-components/columnFilter";

import { createListingPlan } from "./planner";

interface Row {
  name: string;
  score?: number;
  [key: string]: unknown;
}

const getValue = (row: Row, columnId: string): unknown => row[columnId];

const getComparator = () => undefined;

describe("createListingPlan", () => {
  it("resolves constant filter metadata once before scanning rows", () => {
    let filterTypeCalls = 0;
    const getFilterType = (columnId: string): FilterType | undefined => {
      filterTypeCalls += 1;
      return columnId === "score" ? "number" : undefined;
    };
    const plan = createListingPlan<Row>({
      filter: new Column("score").gt("0.5"),
      getValue,
      getComparator,
      getFilterType,
    });
    const rows: Row[] = [
      { name: "high", score: 0.9 },
      { name: "low", score: 0.1 },
      { name: "missing" },
    ];

    expect(rows.filter(plan.matches).map((row) => row.name)).toEqual(["high"]);
    expect(filterTypeCalls).toBe(1);
  });
});
