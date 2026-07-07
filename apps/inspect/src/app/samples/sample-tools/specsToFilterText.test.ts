import { describe, expect, it } from "vitest";

import type {
  ColumnFilter,
  FilterSpec,
  FilterType,
} from "@tsmono/inspect-components/columnFilter";

import { buildSampleFilterSpecRegistry } from "./filterSpecRegistry";
import { specsToFilterText } from "./specsToFilterText";

const registry = buildSampleFilterSpecRegistry(undefined);

const spec = (
  colId: string,
  s: FilterSpec,
  filterType: FilterType = "string"
): ColumnFilter => ({ columnId: colId, filterType, spec: s });

const toText = (entries: Record<string, FilterSpec>): string | null =>
  specsToFilterText(
    Object.fromEntries(
      Object.entries(entries).map(([colId, s]) => [
        colId,
        spec(
          colId,
          s,
          registry.byColId.get(colId)?.kind === "number" ? "number" : "string"
        ),
      ])
    ),
    registry
  );

describe("specsToFilterText", () => {
  it("number comparisons", () => {
    expect(toText({ epoch: { operator: "=", value: "2" } })).toBe("epoch == 2");
    expect(toText({ tokens: { operator: ">=", value: "100" } })).toBe(
      "tokens >= 100"
    );
    expect(toText({ duration: { operator: "<", value: "5" } })).toBe(
      "duration < 5"
    );
  });

  it("between is parenthesized", () => {
    expect(
      toText({ tokens: { operator: "between", value: "100", value2: "500" } })
    ).toBe("(tokens >= 100 and tokens <= 500)");
  });

  it("rejects non-finite numbers", () => {
    expect(toText({ tokens: { operator: "=", value: "abc" } })).toBeNull();
    expect(toText({ tokens: { operator: "=", value: "Infinity" } })).toBeNull();
    expect(
      toText({ tokens: { operator: "between", value: "1", value2: "x" } })
    ).toBeNull();
  });

  it("rejects empty/whitespace numeric values (Number('') is 0)", () => {
    expect(toText({ tokens: { operator: "=", value: "" } })).toBeNull();
    expect(toText({ tokens: { operator: "=", value: "   " } })).toBeNull();
    expect(
      toText({ tokens: { operator: "between", value: " ", value2: "5" } })
    ).toBeNull();
  });

  it("blank operators emit None comparisons", () => {
    expect(toText({ tokens: { operator: "is blank", value: "" } })).toBe(
      "tokens == None"
    );
    expect(toText({ tokens: { operator: "is not blank", value: "" } })).toBe(
      "tokens != None"
    );
  });

  it("contains uses the registered containsFn with regex escaping", () => {
    expect(toText({ input: { operator: "contains", value: "foo" } })).toBe(
      'input_contains("foo")'
    );
    expect(toText({ input: { operator: "contains", value: "a.b+c" } })).toBe(
      'input_contains("a[.]b[+]c")'
    );
    expect(
      toText({ error: { operator: "does not contain", value: "boom" } })
    ).toBe('not error_contains("boom")');
  });

  it("contains falls back to regex for columns without a containsFn", () => {
    expect(toText({ sampleUuid: { operator: "contains", value: "abc" } })).toBe(
      'uuid ~= "abc"'
    );
    expect(
      toText({ sampleUuid: { operator: "does not contain", value: "abc" } })
    ).toBe('not (uuid ~= "abc")');
  });

  it("anchors starts with / ends with", () => {
    expect(toText({ target: { operator: "starts with", value: "pre" } })).toBe(
      'target ~= "^pre"'
    );
    expect(toText({ target: { operator: "ends with", value: "post" } })).toBe(
      'target ~= "post$"'
    );
  });

  it("string equality quotes and escapes", () => {
    expect(toText({ input: { operator: "=", value: "exact" } })).toBe(
      'input == "exact"'
    );
    expect(toText({ input: { operator: "=", value: 'he said "hi"' } })).toBe(
      'input == "he said \\"hi\\""'
    );
    expect(toText({ input: { operator: "=", value: "path\\to" } })).toBe(
      'input == "path\\\\to"'
    );
  });

  it("joins multiple columns with and", () => {
    expect(
      toText({
        epoch: { operator: "=", value: "1" },
        tokens: { operator: ">", value: "100" },
      })
    ).toBe("epoch == 1 and tokens > 100");
  });

  it("returns null when any column is unknown or unrepresentable", () => {
    expect(
      toText({
        sampleStatus: { operator: "=", value: "x" },
        epoch: { operator: "=", value: "1" },
      })
    ).toBeNull();
    expect(toText({ tokens: { operator: "contains", value: "x" } })).toBeNull();
    expect(
      toText({ input: { operator: "not between", value: "a", value2: "b" } })
    ).toBeNull();
  });

  it("returns empty string for no specs", () => {
    expect(specsToFilterText({}, registry)).toBe("");
  });
});
