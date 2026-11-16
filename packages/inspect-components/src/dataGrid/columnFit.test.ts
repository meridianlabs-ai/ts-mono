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

  test("flex floors at its declared width when space is short (grid scrolls)", () => {
    const cols: FitColumn[] = [
      { id: "fixed", size: 300, minSize: 200 },
      { id: "a", flex: 1, size: 160, minSize: 120 },
      { id: "b", flex: 1, size: 160, minSize: 120 },
    ];
    // Auto-layout never compresses below declared widths — the roomy +
    // horizontal-scroll policy. minSize gates user drag-resizes only.
    const widths = resolveColumnWidths(cols, 400, {});
    expect(widths).toEqual({ fixed: 300, a: 160, b: 160 });
  });

  test("a flex column without a declared size floors at its minSize", () => {
    const cols: FitColumn[] = [
      { id: "fixed", size: 300 },
      { id: "a", flex: 1, minSize: 120 },
    ];
    expect(resolveColumnWidths(cols, 350, {})).toEqual({
      fixed: 300,
      a: 120,
    });
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

  test("never shrinks below declared sizes when columns overflow (grid scrolls)", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 400, minSize: 300 },
      { id: "b", size: 400 },
    ];
    expect(resolveColumnWidths(cols, 400, {})).toEqual({ a: 400, b: 400 });
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

  test("a min=max column stays pinned while the others fit around it", () => {
    // `resizable: false` gates drag handles only — like AG, the fit still
    // scales such columns; pinning a width means min === max (the log
    // list's 32px type-icon column).
    const cols: FitColumn[] = [
      { id: "icon", size: 32, minSize: 32, maxSize: 32 },
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
      { id: "a", size: 100, minSize: 100, maxSize: 100 },
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

// TanStack's `column.getSize()` (what renders) clamps every width to
// [minSize ?? 20, maxSize]; the fit must count the same widths.
describe("resolveColumnWidths — matches TanStack's clamped render widths", () => {
  const renderedWidth = (w: number, c: FitColumn): number =>
    Math.min(Math.max(c.minSize ?? 20, w), c.maxSize ?? Infinity);
  const renderedTotal = (
    cols: readonly FitColumn[],
    widths: Record<string, number>
  ) => cols.reduce((sum, c) => sum + renderedWidth(widths[c.id]!, c), 0);

  test("an override below minSize counts at minSize", () => {
    // e.g. a compact-mode score width (36px) carried into upright mode,
    // whose score columns have minSize 60.
    const cols: FitColumn[] = [
      { id: "score", size: 96, minSize: 60, maxSize: 120 },
      { id: "answer", size: 200, minSize: 150, flex: 1 },
    ];
    const widths = resolveColumnWidths(cols, 500, { score: 36 });
    expect(widths).toEqual({ score: 60, answer: 440 });
    expect(renderedTotal(cols, widths)).toBe(500);
  });

  test("an override above maxSize counts at maxSize", () => {
    const cols: FitColumn[] = [
      { id: "score", size: 96, minSize: 60, maxSize: 120 },
      { id: "answer", size: 200, minSize: 150, flex: 1 },
    ];
    const widths = resolveColumnWidths(cols, 500, { score: 300 });
    expect(widths).toEqual({ score: 120, answer: 380 });
    expect(renderedTotal(cols, widths)).toBe(500);
  });

  test("an override with no minSize floors at TanStack's default of 20", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 100 },
      { id: "b", size: 100, flex: 1 },
    ];
    const widths = resolveColumnWidths(cols, 300, { a: 5 });
    expect(widths).toEqual({ a: 20, b: 280 });
  });

  test("a declared size above maxSize counts at maxSize", () => {
    // Upright score columns size to their header (long names exceed the
    // 120px cap).
    const cols: FitColumn[] = [
      { id: "score", size: 164, minSize: 60, maxSize: 120 },
      { id: "answer", size: 200, minSize: 150, flex: 1 },
    ];
    const widths = resolveColumnWidths(cols, 500, {});
    expect(widths).toEqual({ score: 120, answer: 380 });
    expect(renderedTotal(cols, widths)).toBe(500);
  });

  test("a declared size below minSize counts at minSize", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 30, minSize: 60 },
      { id: "b", size: 200, flex: 1 },
    ];
    const widths = resolveColumnWidths(cols, 500, {});
    expect(widths).toEqual({ a: 60, b: 440 });
    expect(renderedTotal(cols, widths)).toBe(500);
  });

  test("passes clamped widths through before the container is measured", () => {
    const cols: FitColumn[] = [
      { id: "a", size: 30, minSize: 60 },
      { id: "b", size: 96, minSize: 60, maxSize: 120 },
    ];
    expect(resolveColumnWidths(cols, 0, { b: 36 })).toEqual({ a: 60, b: 60 });
  });
});
