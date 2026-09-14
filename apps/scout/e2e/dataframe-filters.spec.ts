import { expect, test } from "@playwright/test";

// These expectations were run against the old renderer before removing it.
const cases: {
  column: string;
  type: string;
  filter?: string | number;
  filterTo?: number;
  rows: number[];
}[] = [
  { column: "explanation", type: "contains", filter: "alpha", rows: [0, 3] },
  {
    column: "explanation",
    type: "notContains",
    filter: "alpha",
    rows: [1, 2, 4, 5],
  },
  { column: "explanation", type: "equals", filter: "ALPHA", rows: [3] },
  {
    column: "explanation",
    type: "notEqual",
    filter: "ALPHA",
    rows: [0, 1, 2, 4, 5],
  },
  { column: "explanation", type: "startsWith", filter: "AL", rows: [0, 3] },
  { column: "explanation", type: "endsWith", filter: "TA", rows: [1] },
  { column: "explanation", type: "blank", rows: [2, 4] },
  { column: "explanation", type: "notBlank", rows: [0, 1, 3, 5] },
  { column: "explanation", type: "contains", filter: "no match", rows: [] },
  { column: "value", type: "equals", filter: 2, rows: [1, 4] },
  { column: "value", type: "notEqual", filter: 2, rows: [0, 3, 5] },
  { column: "value", type: "lessThan", filter: 2, rows: [3] },
  { column: "value", type: "lessThanOrEqual", filter: 2, rows: [1, 3, 4] },
  { column: "value", type: "greaterThan", filter: 2, rows: [0, 5] },
  {
    column: "value",
    type: "greaterThanOrEqual",
    filter: 2,
    rows: [0, 1, 4, 5],
  },
  { column: "value", type: "inRange", filter: -4, filterTo: 10, rows: [1, 4] },
  { column: "value", type: "blank", rows: [2] },
  { column: "value", type: "notBlank", rows: [0, 1, 3, 4, 5] },
  { column: "passed", type: "equals", filter: "false", rows: [1, 3, 5] },
  { column: "metadata", type: "contains", filter: "object", rows: [] },
  { column: "metadata", type: "contains", filter: '"index":3', rows: [3] },
];

for (const scenario of cases) {
  test(`${scenario.column} ${scenario.type} ${scenario.filter ?? ""}`, async ({
    page,
  }) => {
    await page.addInitScript(({ column, type, filter, filterTo }) => {
      localStorage.setItem(
        "inspect-scout-storage",
        JSON.stringify({
          version: 1,
          state: {
            gridStates: {
              DataframeView: {
                filter: {
                  filterModel: {
                    [column]: {
                      filterType: column === "value" ? "number" : "text",
                      type,
                      filter,
                      filterTo,
                    },
                  },
                },
              },
            },
          },
        })
      );
    }, scenario);
    await page.goto("/e2e/fixtures/dataframe/");
    await expect(page.getByLabel("Visible rows")).toHaveText(
      String(scenario.rows.length)
    );
    const transcripts = page
      .getByRole("gridcell")
      .filter({ hasText: /^transcript-\d+$/ });
    await expect(transcripts).toHaveText(
      scenario.rows.map(
        (index) => `transcript-${index.toString().padStart(4, "0")}`
      )
    );
  });
}
