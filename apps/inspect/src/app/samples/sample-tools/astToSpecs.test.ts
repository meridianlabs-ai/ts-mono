import { describe, expect, it } from "vitest";

import type {
  ColumnFilter,
  FilterSpec,
} from "@tsmono/inspect-components/columnFilter";

import { astToSpecs, parseFilterSpecs } from "./astToSpecs";
import { parseFilter } from "./filterAst";
import { buildSampleFilterSpecRegistry } from "./filterSpecRegistry";
import { specsToFilterText } from "./specsToFilterText";

const registry = buildSampleFilterSpecRegistry(undefined);

const toSpecs = (text: string): Record<string, ColumnFilter> | null =>
  parseFilterSpecs(text, registry);

const entry = (colId: string, s: FilterSpec): ColumnFilter => ({
  columnId: colId,
  filterType:
    registry.byColId.get(colId)?.kind === "number" ? "number" : "string",
  spec: s,
});

describe("astToSpecs / parseFilterSpecs — number column simple ops", () => {
  it("equals", () => {
    expect(toSpecs("epoch == 2")).toEqual({
      epoch: entry("epoch", { operator: "=", value: "2" }),
    });
  });

  it("comparators", () => {
    expect(toSpecs("tokens > 100")).toEqual({
      tokens: entry("tokens", { operator: ">", value: "100" }),
    });
    expect(toSpecs("duration <= 1.5")).toEqual({
      duration: entry("duration", { operator: "<=", value: "1.5" }),
    });
  });

  it("between detected from `>= a and <= b`", () => {
    expect(toSpecs("tokens >= 100 and tokens <= 500")).toEqual({
      tokens: entry("tokens", {
        operator: "between",
        value: "100",
        value2: "500",
      }),
    });
  });

  it("order-independent: `<= b and >= a` also folds to between", () => {
    expect(toSpecs("tokens <= 500 and tokens >= 100")).toEqual({
      tokens: entry("tokens", {
        operator: "between",
        value: "100",
        value2: "500",
      }),
    });
  });

  it("two non-foldable conditions on the same column is rejected (accepted parity loss)", () => {
    expect(toSpecs("tokens > 100 and tokens < 500")).toBeNull();
  });

  it("blank / notBlank via None", () => {
    expect(toSpecs("tokens == None")).toEqual({
      tokens: entry("tokens", { operator: "is blank", value: "" }),
    });
    expect(toSpecs("tokens != None")).toEqual({
      tokens: entry("tokens", { operator: "is not blank", value: "" }),
    });
  });
});

describe("astToSpecs / parseFilterSpecs — string columns", () => {
  it("equals / notEqual on string column", () => {
    expect(toSpecs('input == "hello"')).toEqual({
      input: entry("input", { operator: "=", value: "hello" }),
    });
    expect(toSpecs('input != "x"')).toEqual({
      input: entry("input", { operator: "!=", value: "x" }),
    });
  });

  it("xxx_contains() → contains", () => {
    expect(toSpecs('input_contains("foo")')).toEqual({
      input: entry("input", { operator: "contains", value: "foo" }),
    });
  });

  it("not xxx_contains() → does not contain", () => {
    expect(toSpecs('not error_contains("boom")')).toEqual({
      error: entry("error", { operator: "does not contain", value: "boom" }),
    });
  });

  it("regex-escaped contains argument unescapes round-trip", () => {
    // What specsToFilterText emits for filter value "a.b+c" — character
    // classes for metachars (filtrex's lexer rejects `\.` / `\+` etc.).
    expect(toSpecs('input_contains("a[.]b[+]c")')).toEqual({
      input: entry("input", { operator: "contains", value: "a.b+c" }),
    });
  });

  it("~= '^prefix' → starts with", () => {
    expect(toSpecs('target ~= "^pre"')).toEqual({
      target: entry("target", { operator: "starts with", value: "pre" }),
    });
  });

  it("~= 'suffix$' → ends with", () => {
    expect(toSpecs('target ~= "post$"')).toEqual({
      target: entry("target", { operator: "ends with", value: "post" }),
    });
  });

  it("~= 'literal' → contains (no anchors)", () => {
    // `uuid` is a registered string column without a contains-fn.
    expect(toSpecs('uuid ~= "abc"')).toEqual({
      sampleUuid: entry("sampleUuid", { operator: "contains", value: "abc" }),
    });
  });

  it("not (~= 'literal') → does not contain", () => {
    expect(toSpecs('not (uuid ~= "abc")')).toEqual({
      sampleUuid: entry("sampleUuid", {
        operator: "does not contain",
        value: "abc",
      }),
    });
  });

  it("~= '^both$' → equals", () => {
    expect(toSpecs('uuid ~= "^xyz$"')).toEqual({
      sampleUuid: entry("sampleUuid", { operator: "=", value: "xyz" }),
    });
  });

  it("negated starts-with is not representable", () => {
    expect(toSpecs('not target ~= "^pre"')).toBeNull();
  });

  it("`id` is not synced (numeric/string ambiguity)", () => {
    expect(toSpecs('id == "1"')).toBeNull();
    expect(toSpecs("id == 1")).toBeNull();
  });

  it("blank / notBlank for string column", () => {
    expect(toSpecs("error == None")).toEqual({
      error: entry("error", { operator: "is blank", value: "" }),
    });
  });
});

describe("astToSpecs / parseFilterSpecs — multi-column", () => {
  it("AND of two columns", () => {
    expect(toSpecs("epoch == 1 and tokens > 100")).toEqual({
      epoch: entry("epoch", { operator: "=", value: "1" }),
      tokens: entry("tokens", { operator: ">", value: "100" }),
    });
  });
});

describe("astToSpecs / parseFilterSpecs — non-round-trippable", () => {
  it("OR is rejected", () => {
    expect(toSpecs("epoch == 1 or epoch == 2")).toBeNull();
  });

  it("arithmetic in predicate is rejected", () => {
    expect(toSpecs("tokens + 5 == 10")).toBeNull();
  });

  it("unknown variable is rejected", () => {
    expect(toSpecs("foo > 5")).toBeNull();
  });

  it("regex with real metachars is rejected", () => {
    expect(toSpecs('input ~= "(test)"')).toBeNull();
  });

  it("3+ predicates on same column is rejected", () => {
    expect(toSpecs("tokens > 1 and tokens > 2 and tokens > 3")).toBeNull();
  });

  it("type mismatch (string literal on number column) is rejected", () => {
    expect(toSpecs('tokens == "five"')).toBeNull();
  });

  it("bare variable leaf is rejected", () => {
    expect(toSpecs("has_error")).toBeNull();
  });

  it("`in` is unhandled", () => {
    expect(toSpecs("epoch in (1, 2)")).toBeNull();
  });
});

describe("parseFilterSpecs — empty text and parse errors", () => {
  it("empty / whitespace-only text is an empty spec map", () => {
    expect(parseFilterSpecs("", registry)).toEqual({});
    expect(parseFilterSpecs("   ", registry)).toEqual({});
  });

  it("a parse error is rejected", () => {
    expect(parseFilterSpecs("epoch ==", registry)).toBeNull();
  });
});

describe("astToSpecs — round-trip stability (text → specs → text)", () => {
  const roundTrip = (text: string): string | null => {
    const { ast } = parseFilter(text);
    if (!ast) return null;
    const specs = astToSpecs(ast, registry);
    if (!specs) return null;
    return specsToFilterText(specs, registry);
  };

  it("xxx_contains stays as xxx_contains", () => {
    expect(roundTrip('target_contains("No")')).toBe('target_contains("No")');
  });

  it("number comparisons survive", () => {
    expect(roundTrip("epoch == 2")).toBe("epoch == 2");
  });

  it("between round-trips through the parenthesized AND form", () => {
    // The synthesizer emits between as `(var >= a and var <= b)` and the
    // recognizer recovers it.
    expect(roundTrip("tokens >= 100 and tokens <= 500")).toBe(
      "(tokens >= 100 and tokens <= 500)"
    );
  });

  it("filter values with backslashes survive", () => {
    expect(roundTrip('input == "path\\\\to"')).toBe('input == "path\\\\to"');
  });

  it("multi-column AND survives", () => {
    expect(roundTrip("epoch == 1 and tokens > 100")).toBe(
      "epoch == 1 and tokens > 100"
    );
  });
});

describe("astToSpecs — reverse round-trip (specs → text → specs)", () => {
  it("contains with a regex metachar in the value", () => {
    const specs: Record<string, ColumnFilter> = {
      input: entry("input", { operator: "contains", value: "a.b" }),
    };
    const text = specsToFilterText(specs, registry);
    expect(text).not.toBeNull();
    expect(parseFilterSpecs(text!, registry)).toEqual(specs);
  });
});
