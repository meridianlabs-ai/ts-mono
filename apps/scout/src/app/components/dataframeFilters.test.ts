import { expect, it } from "vitest";

import type { UiOperator } from "@tsmono/inspect-components/columnFilter";

import { matchesDataframeFilter } from "./dataframeModel";

const values: Record<string, unknown[]> = {
  explanation: [
    'Alpha, quoted "text"\nnext line',
    "beta",
    "",
    "ALPHA",
    null,
    "Long explanation",
  ],
  value: [10, 2, null, -4, 2, 100],
  passed: [true, false, true, false, true, false],
  metadata: Array.from({ length: 6 }, (_, index) => ({
    index,
    tags: ["a", "b"],
  })),
};

const cases: {
  column: string;
  operator: UiOperator;
  value?: string | number;
  value2?: number;
  rows: number[];
}[] = [
  { column: "explanation", operator: "contains", value: "alpha", rows: [0, 3] },
  {
    column: "explanation",
    operator: "does not contain",
    value: "alpha",
    rows: [1, 2, 4, 5],
  },
  { column: "explanation", operator: "=", value: "ALPHA", rows: [3] },
  {
    column: "explanation",
    operator: "!=",
    value: "ALPHA",
    rows: [0, 1, 2, 4, 5],
  },
  { column: "explanation", operator: "starts with", value: "AL", rows: [0, 3] },
  { column: "explanation", operator: "ends with", value: "TA", rows: [1] },
  { column: "explanation", operator: "is blank", rows: [2, 4] },
  { column: "explanation", operator: "is not blank", rows: [0, 1, 3, 5] },
  { column: "explanation", operator: "contains", value: "no match", rows: [] },
  { column: "value", operator: "=", value: 2, rows: [1, 4] },
  { column: "value", operator: "!=", value: 2, rows: [0, 3, 5] },
  { column: "value", operator: "<", value: 2, rows: [3] },
  { column: "value", operator: "<=", value: 2, rows: [1, 3, 4] },
  { column: "value", operator: ">", value: 2, rows: [0, 5] },
  {
    column: "value",
    operator: ">=",
    value: 2,
    rows: [0, 1, 4, 5],
  },
  { column: "value", operator: "between", value: -4, value2: 10, rows: [1, 4] },
  { column: "value", operator: "is blank", rows: [2] },
  { column: "value", operator: "is not blank", rows: [0, 1, 3, 4, 5] },
  { column: "passed", operator: "=", value: "false", rows: [1, 3, 5] },
  { column: "metadata", operator: "contains", value: "object", rows: [] },
  { column: "metadata", operator: "contains", value: '"index":3', rows: [3] },
];

it.each(cases)(
  "$column $operator $value",
  ({ column, operator, value, value2, rows }) => {
    const matching = (values[column] ?? []).flatMap((cell, index) =>
      matchesDataframeFilter(cell, {
        columnId: column,
        filterType: column === "value" ? "number" : "string",
        spec: {
          operator,
          value: String(value ?? ""),
          ...(value2 === undefined ? {} : { value2: String(value2) }),
        },
      })
        ? [index]
        : []
    );
    expect(matching).toEqual(rows);
  }
);
