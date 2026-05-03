import { describe, expect, test } from "vitest";

import { astToFilterModel } from "./astToFilterModel";
import { parseFilter } from "./filterAst";
import { filterModelToText } from "./filterModelToText";
import { buildSampleFilterRegistry } from "./filterRegistry";

const registry = buildSampleFilterRegistry(undefined);

const toModel = (text: string) => {
  const { ast } = parseFilter(text);
  if (!ast) throw new Error(`parse failed for: ${text}`);
  return astToFilterModel(ast, registry);
};

describe("astToFilterModel — number column simple ops", () => {
  test("equals", () => {
    expect(toModel("epoch == 2")).toEqual({
      epoch: { filterType: "number", type: "equals", filter: 2 },
    });
  });

  test("comparators", () => {
    expect(toModel("tokens > 100")).toEqual({
      tokens: { filterType: "number", type: "greaterThan", filter: 100 },
    });
    expect(toModel("duration <= 1.5")).toEqual({
      duration: { filterType: "number", type: "lessThanOrEqual", filter: 1.5 },
    });
  });

  test("inRange detected from `>= a and <= b`", () => {
    expect(toModel("tokens >= 100 and tokens <= 500")).toEqual({
      tokens: {
        filterType: "number",
        type: "inRange",
        filter: 100,
        filterTo: 500,
      },
    });
  });

  test("two non-range conditions on same numeric column → combined AND", () => {
    expect(toModel("tokens > 100 and tokens < 500")).toEqual({
      tokens: {
        filterType: "number",
        operator: "AND",
        conditions: [
          { type: "greaterThan", filter: 100 },
          { type: "lessThan", filter: 500 },
        ],
      },
    });
  });

  test("blank / notBlank via None", () => {
    expect(toModel("tokens == None")).toEqual({
      tokens: { filterType: "number", type: "blank" },
    });
    expect(toModel("tokens != None")).toEqual({
      tokens: { filterType: "number", type: "notBlank" },
    });
  });
});

describe("astToFilterModel — string columns", () => {
  test("equals / notEqual on string column", () => {
    expect(toModel('input == "hello"')).toEqual({
      input: { filterType: "text", type: "equals", filter: "hello" },
    });
    expect(toModel('input != "x"')).toEqual({
      input: { filterType: "text", type: "notEqual", filter: "x" },
    });
  });

  test("xxx_contains() → contains", () => {
    expect(toModel('input_contains("foo")')).toEqual({
      input: { filterType: "text", type: "contains", filter: "foo" },
    });
    expect(toModel('target_contains("No")')).toEqual({
      target: { filterType: "text", type: "contains", filter: "No" },
    });
    expect(toModel('answer_contains("yes")')).toEqual({
      answer: { filterType: "text", type: "contains", filter: "yes" },
    });
  });

  test("not xxx_contains() → notContains", () => {
    expect(toModel('not error_contains("boom")')).toEqual({
      error: { filterType: "text", type: "notContains", filter: "boom" },
    });
  });

  test("regex-escaped contains argument unescapes round-trip", () => {
    // What filterModelToText would emit for filter value "a.b+c".
    expect(toModel('input_contains("a\\.b\\+c")')).toEqual({
      input: { filterType: "text", type: "contains", filter: "a.b+c" },
    });
  });

  test("~= '^prefix' → startsWith", () => {
    expect(toModel('target ~= "^pre"')).toEqual({
      target: { filterType: "text", type: "startsWith", filter: "pre" },
    });
  });

  test("~= 'suffix$' → endsWith", () => {
    expect(toModel('target ~= "post$"')).toEqual({
      target: { filterType: "text", type: "endsWith", filter: "post" },
    });
  });

  test("~= 'literal' → contains (no anchors)", () => {
    // `id` is the filtrex variable for the sampleId column.
    expect(toModel('id ~= "abc"')).toEqual({
      sampleId: { filterType: "text", type: "contains", filter: "abc" },
    });
  });

  test("~= '^both$' → equals", () => {
    expect(toModel('id ~= "^xyz$"')).toEqual({
      sampleId: { filterType: "text", type: "equals", filter: "xyz" },
    });
  });

  test("blank / notBlank for string column", () => {
    expect(toModel("error == None")).toEqual({
      error: { filterType: "text", type: "blank" },
    });
  });
});

describe("astToFilterModel — multi-column", () => {
  test("AND of two columns", () => {
    expect(toModel("epoch == 1 and tokens > 100")).toEqual({
      epoch: { filterType: "number", type: "equals", filter: 1 },
      tokens: { filterType: "number", type: "greaterThan", filter: 100 },
    });
  });

  test("preserves the user's tokens predicate when adding a duration filter", () => {
    // The exact bug the user reported.
    expect(toModel("tokens > 50 and duration > 1")).toEqual({
      tokens: { filterType: "number", type: "greaterThan", filter: 50 },
      duration: { filterType: "number", type: "greaterThan", filter: 1 },
    });
  });
});

describe("astToFilterModel — round-trip stability (text → model → text)", () => {
  const roundTrip = (text: string): string | null => {
    const { ast } = parseFilter(text);
    if (!ast) return null;
    const model = astToFilterModel(ast, registry);
    if (!model) return null;
    return filterModelToText(model, registry);
  };

  test("xxx_contains stays as xxx_contains", () => {
    expect(roundTrip('target_contains("No")')).toBe('target_contains("No")');
    expect(roundTrip('input_contains("hello")')).toBe(
      'input_contains("hello")'
    );
  });

  test("number comparisons survive", () => {
    expect(roundTrip("epoch == 2")).toBe("epoch == 2");
    expect(roundTrip("tokens > 100")).toBe("tokens > 100");
  });

  test("inRange round-trips through the parenthesized AND form", () => {
    // The synthesizer emits inRange as `(var >= a and var <= b)` and the
    // recognizer recovers it.
    expect(roundTrip("tokens >= 100 and tokens <= 500")).toBe(
      "(tokens >= 100 and tokens <= 500)"
    );
  });

  test("multi-column AND survives", () => {
    expect(roundTrip("tokens > 50 and duration > 1")).toBe(
      "tokens > 50 and duration > 1"
    );
  });
});

describe("astToFilterModel — non-round-trippable", () => {
  test("OR is rejected", () => {
    expect(toModel("epoch == 1 or epoch == 2")).toBeNull();
  });

  test("arithmetic in predicate is rejected", () => {
    expect(toModel("tokens + 5 == 10")).toBeNull();
  });

  test("unknown variable is rejected", () => {
    expect(toModel("foo > 5")).toBeNull();
  });

  test("regex with real metachars is rejected", () => {
    expect(toModel('input ~= "(test)"')).toBeNull();
  });

  test("3+ predicates on same column is rejected", () => {
    expect(toModel("tokens > 1 and tokens > 2 and tokens > 3")).toBeNull();
  });

  test("type mismatch (string literal on number column) is rejected", () => {
    expect(toModel('tokens == "five"')).toBeNull();
  });
});
