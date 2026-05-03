import { describe, expect, test } from "vitest";

import { filterModelToText } from "./filterModelToText";
import { buildSampleFilterRegistry } from "./filterRegistry";

const registry = buildSampleFilterRegistry(undefined);

describe("filterModelToText — number columns", () => {
  test("equals", () => {
    expect(
      filterModelToText({ epoch: { type: "equals", filter: 2 } }, registry)
    ).toBe("epoch == 2");
  });

  test("comparators", () => {
    expect(
      filterModelToText(
        { tokens: { type: "greaterThanOrEqual", filter: 100 } },
        registry
      )
    ).toBe("tokens >= 100");
    expect(
      filterModelToText({ duration: { type: "lessThan", filter: 5 } }, registry)
    ).toBe("duration < 5");
  });

  test("inRange becomes a parenthesized AND", () => {
    expect(
      filterModelToText(
        { tokens: { type: "inRange", filter: 100, filterTo: 500 } },
        registry
      )
    ).toBe("(tokens >= 100 and tokens <= 500)");
  });

  test("NaN / Infinity filter values are skipped (mid-type input)", () => {
    expect(
      filterModelToText({ tokens: { type: "equals", filter: NaN } }, registry)
    ).toBeNull();
    expect(
      filterModelToText(
        { tokens: { type: "equals", filter: Infinity } },
        registry
      )
    ).toBeNull();
    expect(
      filterModelToText(
        { tokens: { type: "inRange", filter: 1, filterTo: NaN } },
        registry
      )
    ).toBeNull();
  });

  test("blank/notBlank", () => {
    expect(filterModelToText({ tokens: { type: "blank" } }, registry)).toBe(
      "tokens == null"
    );
    expect(filterModelToText({ tokens: { type: "notBlank" } }, registry)).toBe(
      "tokens != null"
    );
  });
});

describe("filterModelToText — string columns with contains-fn", () => {
  test("contains uses the case-insensitive function", () => {
    expect(
      filterModelToText(
        { input: { type: "contains", filter: "foo" } },
        registry
      )
    ).toBe('input_contains("foo")');
  });

  test("regex metacharacters in the filter value are escaped", () => {
    expect(
      filterModelToText(
        { input: { type: "contains", filter: "a.b+c" } },
        registry
      )
    ).toBe('input_contains("a\\\\.b\\\\+c")');
  });

  test("notContains negates the function call", () => {
    expect(
      filterModelToText(
        { error: { type: "notContains", filter: "boom" } },
        registry
      )
    ).toBe('not error_contains("boom")');
  });

  test("equals uses literal string comparison", () => {
    expect(
      filterModelToText(
        { input: { type: "equals", filter: "exact" } },
        registry
      )
    ).toBe('input == "exact"');
  });

  test("startsWith / endsWith use anchored regex", () => {
    expect(
      filterModelToText(
        { target: { type: "startsWith", filter: "pre" } },
        registry
      )
    ).toBe('target ~= "^pre"');
    expect(
      filterModelToText(
        { target: { type: "endsWith", filter: "post" } },
        registry
      )
    ).toBe('target ~= "post$"');
  });
});

describe("filterModelToText — string columns without contains-fn", () => {
  test("contains falls back to filtrex regex match", () => {
    expect(
      filterModelToText(
        { sampleId: { type: "contains", filter: "abc" } },
        registry
      )
    ).toBe('id ~= "abc"');
  });
});

describe("filterModelToText — combined per-column conditions", () => {
  test("AND of two conditions", () => {
    expect(
      filterModelToText(
        {
          tokens: {
            operator: "AND",
            conditions: [
              { type: "greaterThan", filter: 100 },
              { type: "lessThan", filter: 500 },
            ],
          },
        },
        registry
      )
    ).toBe("(tokens > 100 and tokens < 500)");
  });

  test("OR of two conditions", () => {
    expect(
      filterModelToText(
        {
          epoch: {
            operator: "OR",
            conditions: [
              { type: "equals", filter: 1 },
              { type: "equals", filter: 3 },
            ],
          },
        },
        registry
      )
    ).toBe("(epoch == 1 or epoch == 3)");
  });

  test("legacy condition1/condition2 shape", () => {
    expect(
      filterModelToText(
        {
          tokens: {
            operator: "AND",
            condition1: { type: "greaterThan", filter: 0 },
            condition2: { type: "lessThan", filter: 10 },
          },
        },
        registry
      )
    ).toBe("(tokens > 0 and tokens < 10)");
  });
});

describe("filterModelToText — multi-column", () => {
  test("multiple columns are joined with AND", () => {
    expect(
      filterModelToText(
        {
          epoch: { type: "equals", filter: 1 },
          tokens: { type: "greaterThan", filter: 100 },
        },
        registry
      )
    ).toBe("epoch == 1 and tokens > 100");
  });

  test("unrepresentable columns are dropped", () => {
    expect(
      filterModelToText(
        {
          // sampleStatus has no registry entry — dropped.
          sampleStatus: { type: "equals", filter: "anything" },
          epoch: { type: "equals", filter: 1 },
        },
        registry
      )
    ).toBe("epoch == 1");
  });
});

describe("filterModelToText — empty / null cases", () => {
  test("null model returns null", () => {
    expect(filterModelToText(null, registry)).toBeNull();
  });

  test("empty object returns null", () => {
    expect(filterModelToText({}, registry)).toBeNull();
  });

  test("only-unrepresentable columns returns null", () => {
    expect(
      filterModelToText(
        { sampleStatus: { type: "equals", filter: "x" } },
        registry
      )
    ).toBeNull();
  });
});
