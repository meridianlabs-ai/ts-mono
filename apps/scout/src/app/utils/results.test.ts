import { describe, expect, it } from "vitest";

import { ScanResultSummary } from "../types";

import { sortByColumns, sortValue, stringifyValue } from "./results";

const baseSummary: ScanResultSummary = {
  identifier: "test-1",
  inputType: "transcript",
  eventReferences: [],
  messageReferences: [],
  validationResult: false,
  validationTarget: null,
  value: null,
  valueType: "null",
  transcriptSourceId: "src-1",
  transcriptMetadata: {},
};

/** Create a ScanResultSummary with only the fields under test overridden. */
const make = (overrides: Partial<ScanResultSummary>): ScanResultSummary => ({
  ...baseSummary,
  ...overrides,
});

describe("stringifyValue", () => {
  it.each<{ name: string; summary: ScanResultSummary; expected: string }>([
    {
      name: "null value",
      summary: make({ value: null, valueType: "null" }),
      expected: "",
    },
    {
      name: "string value",
      summary: make({ value: "hello world", valueType: "string" }),
      expected: "hello world",
    },
    {
      name: "number value",
      summary: make({ value: 42, valueType: "number" }),
      expected: "42",
    },
    {
      name: "boolean true",
      summary: make({ value: true, valueType: "boolean" }),
      expected: "true",
    },
    {
      name: "boolean false",
      summary: make({ value: false, valueType: "boolean" }),
      expected: "false",
    },
    {
      name: "array value",
      summary: make({ value: ["a", "b", "c"], valueType: "array" }),
      expected: "a b c",
    },
    {
      name: "object value",
      summary: make({
        value: { score: 0.95, label: "pass" },
        valueType: "object",
      }),
      expected: "score 0.95 label pass",
    },
    {
      name: "object with null value field",
      summary: make({
        value: { key: null },
        valueType: "object",
      }),
      expected: "key ",
    },
  ])("$name", ({ summary, expected }) => {
    expect(stringifyValue(summary)).toBe(expected);
  });
});

describe("sortValue", () => {
  it("sorts nulls last", () => {
    const a = make({ value: null, valueType: "null" });
    const b = make({ value: 1, valueType: "number" });
    expect(sortValue(a, b)).toBeGreaterThan(0);
    expect(sortValue(b, a)).toBeLessThan(0);
  });

  it("treats two nulls as equal", () => {
    const a = make({ value: null, valueType: "null" });
    const b = make({ value: null, valueType: "null" });
    expect(sortValue(a, b)).toBe(0);
  });

  it("compares numbers numerically", () => {
    const a = make({ value: 2, valueType: "number" });
    const b = make({ value: 10, valueType: "number" });
    expect(sortValue(a, b)).toBeLessThan(0);
  });

  it("compares booleans (false < true)", () => {
    const a = make({ value: false, valueType: "boolean" });
    const b = make({ value: true, valueType: "boolean" });
    expect(sortValue(a, b)).toBeLessThan(0);
  });

  it("compares strings lexicographically", () => {
    const a = make({ value: "apple", valueType: "string" });
    const b = make({ value: "banana", valueType: "string" });
    expect(sortValue(a, b)).toBeLessThan(0);
  });

  it("compares arrays by length first", () => {
    const a = make({ value: [1], valueType: "array" });
    const b = make({ value: [1, 2], valueType: "array" });
    expect(sortValue(a, b)).toBeLessThan(0);
  });

  it("falls back to string comparison for different types", () => {
    const a = make({ value: "z", valueType: "string" });
    const b = make({ value: 1, valueType: "number" });
    // "z" vs "1" — string comparison
    expect(sortValue(a, b)).toBeGreaterThan(0);
  });
});

describe("sortByColumns", () => {
  const summaryA = make({
    identifier: "a",
    explanation: "alpha",
    label: "L1",
    value: 1,
    valueType: "number",
    scanError: "",
    transcriptSourceId: "src-a",
  });
  const summaryB = make({
    identifier: "b",
    explanation: "beta",
    label: "L2",
    value: 2,
    valueType: "number",
    scanError: "timeout",
    transcriptSourceId: "src-b",
  });

  it("sorts by explanation ascending", () => {
    const result = sortByColumns(summaryA, summaryB, [
      { column: "Explanation", direction: "asc" },
    ]);
    expect(result).toBeLessThan(0);
  });

  it("sorts by explanation descending", () => {
    const result = sortByColumns(summaryA, summaryB, [
      { column: "Explanation", direction: "desc" },
    ]);
    expect(result).toBeGreaterThan(0);
  });

  it("sorts by value", () => {
    const result = sortByColumns(summaryA, summaryB, [
      { column: "Value", direction: "asc" },
    ]);
    expect(result).toBeLessThan(0);
  });

  it("sorts by error", () => {
    const result = sortByColumns(summaryA, summaryB, [
      { column: "Error", direction: "desc" },
    ]);
    // summaryA has "" error, summaryB has "timeout" — desc puts "timeout" first
    expect(result).toBeGreaterThan(0);
  });

  it("uses secondary sort when primary is equal", () => {
    const s1 = make({
      explanation: "same",
      value: 10,
      valueType: "number",
      transcriptSourceId: "src-1",
    });
    const s2 = make({
      explanation: "same",
      value: 20,
      valueType: "number",
      transcriptSourceId: "src-2",
    });
    const result = sortByColumns(s1, s2, [
      { column: "Explanation", direction: "asc" },
      { column: "Value", direction: "asc" },
    ]);
    expect(result).toBeLessThan(0);
  });

  it("returns 0 when all columns are equal", () => {
    const result = sortByColumns(summaryA, summaryA, [
      { column: "Explanation", direction: "asc" },
      { column: "Value", direction: "asc" },
    ]);
    expect(result).toBe(0);
  });

  it("skips unknown columns", () => {
    const result = sortByColumns(summaryA, summaryB, [
      { column: "nonexistent", direction: "asc" },
    ]);
    expect(result).toBe(0);
  });
});
