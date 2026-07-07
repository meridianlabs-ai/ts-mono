import { describe, expect, test } from "vitest";

import { resolveColumnWidths, type FitColumn } from "./columnFit";

const total = (widths: Record<string, number>) =>
  Object.values(widths).reduce((sum, w) => sum + w, 0);

describe("resolveColumnWidths — width unknown", () => {
  test("returns base sizes before the container has been measured", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 100 },
      { id: "b", size: 300, flex: 1 },
      { id: "c", minSize: 40 },
    ];
    expect(resolveColumnWidths(cols, 0, {})).toEqual({
      a: 100,
      b: 300,
      c: 40,
    });
  });
});

describe("resolveColumnWidths — flex distribution", () => {
  test("fixed columns keep their size; flex columns split the leftover by weight", () => {
    const cols: FitColumn[] = [
      { id: "fixed", size: 100 },
      { id: "one", size: 50, flex: 1 },
      { id: "three", size: 50, flex: 3 },
    ];
    expect(resolveColumnWidths(cols, 500, {})).toEqual({
      fixed: 100,
      one: 100,
      three: 300,
    });
  });

  test("flex floors at minSize when space is short (total may overflow)", () => {
    const cols: FitColumn[] = [
      { id: "fixed", size: 300 },
      { id: "a", flex: 1, minSize: 120 },
      { id: "b", flex: 1, minSize: 120 },
    ];
    const widths = resolveColumnWidths(cols, 400, {});
    expect(widths).toEqual({ fixed: 300, a: 120, b: 120 });
  });

  test("a maxSize-capped flex column yields its excess to the others", () => {
    const cols: FitColumn[] = [
      { id: "capped", flex: 1, maxSize: 100 },
      { id: "open", flex: 1 },
    ];
    expect(resolveColumnWidths(cols, 600, {})).toEqual({
      capped: 100,
      open: 500,
    });
  });

  test("an overridden flex column becomes fixed at the override", () => {
    const cols: FitColumn[] = [
      { id: "a", flex: 1 },
      { id: "b", flex: 1 },
    ];
    expect(resolveColumnWidths(cols, 600, { a: 150 })).toEqual({
      a: 150,
      b: 450,
    });
  });
});

describe("resolveColumnWidths — proportional scaling (no flex)", () => {
  test("scales all resizable columns to fill the width", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 100 },
      { id: "b", size: 300 },
    ];
    expect(resolveColumnWidths(cols, 800, {})).toEqual({ a: 200, b: 600 });
  });

  test("shrinks when columns overflow, flooring at minSize", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 400, minSize: 300 },
      { id: "b", size: 400 },
    ];
    const widths = resolveColumnWidths(cols, 400, {});
    expect(widths.a).toBe(300);
    expect(widths.b).toBeLessThan(400);
  });

  test("maxSize caps growth and the remainder flows to uncapped columns", () => {
    const cols: FitColumn[] = [
      { id: "capped", size: 100, maxSize: 120 },
      { id: "open", size: 100 },
    ];
    expect(resolveColumnWidths(cols, 600, {})).toEqual({
      capped: 120,
      open: 480,
    });
  });

  test("non-resizable columns never scale", () => {
    const cols: FitColumn[] = [
      { id: "icon", size: 32, resizable: false },
      { id: "name", size: 100 },
    ];
    expect(resolveColumnWidths(cols, 532, {})).toEqual({
      icon: 32,
      name: 500,
    });
  });

  test("overridden columns keep the override and are excluded from scaling", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 100 },
      { id: "b", size: 100 },
    ];
    expect(resolveColumnWidths(cols, 600, { a: 250 })).toEqual({
      a: 250,
      b: 350,
    });
  });

  test("when every column is pinned in place the widths pass through", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 100, resizable: false },
      { id: "b", size: 100, maxSize: 100 },
    ];
    expect(resolveColumnWidths(cols, 900, {})).toEqual({ a: 100, b: 100 });
  });
});

describe("resolveColumnWidths — rounding", () => {
  test("integer widths that never exceed the available width", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 100, flex: 1 },
      { id: "b", size: 100, flex: 1 },
      { id: "c", size: 100, flex: 1 },
    ];
    const widths = resolveColumnWidths(cols, 1000, {});
    for (const w of Object.values(widths)) {
      expect(Number.isInteger(w)).toBe(true);
    }
    expect(total(widths)).toBeLessThanOrEqual(1000);
    expect(total(widths)).toBeGreaterThanOrEqual(997);
  });
});
