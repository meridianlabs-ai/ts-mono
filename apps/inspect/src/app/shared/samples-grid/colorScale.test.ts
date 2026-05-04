import { describe, expect, test } from "vitest";

import {
  colorForValue,
  resolveScale,
  type ResolvedScale,
  type WireScoreColorScale,
} from "./colorScale";

describe("resolveScale", () => {
  test("named palette resolves to gradient with descriptor bounds", () => {
    const r = resolveScale("good-high", { min: 0, max: 1 });
    expect(r).toEqual({
      kind: "gradient",
      low: "var(--bs-danger-bg-subtle)",
      mid: "var(--bs-warning-bg-subtle)",
      high: "var(--bs-success-bg-subtle)",
      min: 0,
      max: 1,
    });
  });

  test("good-low flips low and high stops", () => {
    const r = resolveScale("good-low", { min: 0, max: 1 }) as Extract<
      ResolvedScale,
      { kind: "gradient" }
    >;
    expect(r.low).toBe("var(--bs-success-bg-subtle)");
    expect(r.high).toBe("var(--bs-danger-bg-subtle)");
  });

  test("named palette without bounds returns null", () => {
    expect(resolveScale("good-high", {})).toBeNull();
    expect(resolveScale("good-high", { min: 0 })).toBeNull();
  });

  test("named palette with min === max returns null", () => {
    // Equal bounds would land every value at the midpoint stop —
    // nothing to interpolate; better to skip.
    expect(resolveScale("good-high", { min: 1, max: 1 })).toBeNull();
  });

  test("unknown palette name returns null", () => {
    const bogus = "rainbow" as unknown as WireScoreColorScale;
    expect(resolveScale(bogus, { min: 0, max: 1 })).toBeNull();
  });

  test("categorical map resolves regardless of bounds", () => {
    const r = resolveScale(
      { yes: "bad", no: "good", maybe: "warn" },
      {},
    );
    expect(r).toEqual({
      kind: "categorical",
      colors: {
        yes: "var(--bs-danger-bg-subtle)",
        no: "var(--bs-success-bg-subtle)",
        maybe: "var(--bs-warning-bg-subtle)",
      },
    });
  });
});

describe("colorForValue (gradient)", () => {
  const scale = resolveScale("good-high", { min: 0, max: 1 })!;

  test("min value emits 100% low (no mid mix)", () => {
    expect(colorForValue(scale, 0)).toBe(
      "color-mix(in srgb, var(--bs-danger-bg-subtle) 100%, var(--bs-warning-bg-subtle))",
    );
  });

  test("max value emits 100% high (no mid mix)", () => {
    expect(colorForValue(scale, 1)).toBe(
      "color-mix(in srgb, var(--bs-success-bg-subtle) 100%, var(--bs-warning-bg-subtle))",
    );
  });

  test("midpoint emits 0% of either stop (pure mid)", () => {
    expect(colorForValue(scale, 0.5)).toBe(
      "color-mix(in srgb, var(--bs-danger-bg-subtle) 0%, var(--bs-warning-bg-subtle))",
    );
  });

  test("values outside [min, max] clamp to extreme", () => {
    expect(colorForValue(scale, -5)).toBe(colorForValue(scale, 0));
    expect(colorForValue(scale, 99)).toBe(colorForValue(scale, 1));
  });

  test("non-numeric / NaN values return undefined", () => {
    expect(colorForValue(scale, "high")).toBeUndefined();
    expect(colorForValue(scale, NaN)).toBeUndefined();
    expect(colorForValue(scale, null)).toBeUndefined();
    expect(colorForValue(scale, undefined)).toBeUndefined();
  });
});

describe("colorForValue (categorical)", () => {
  const scale = resolveScale(
    { yes: "bad", no: "good", "1": "good", "true": "good" },
    {},
  )!;

  test("string value looks up in map", () => {
    expect(colorForValue(scale, "yes")).toBe("var(--bs-danger-bg-subtle)");
    expect(colorForValue(scale, "no")).toBe("var(--bs-success-bg-subtle)");
  });

  test("numeric and boolean values stringify before lookup", () => {
    expect(colorForValue(scale, 1)).toBe("var(--bs-success-bg-subtle)");
    expect(colorForValue(scale, true)).toBe("var(--bs-success-bg-subtle)");
  });

  test("unmapped value returns undefined (no background)", () => {
    expect(colorForValue(scale, "maybe")).toBeUndefined();
    expect(colorForValue(scale, null)).toBeUndefined();
    expect(colorForValue(scale, undefined)).toBeUndefined();
  });
});
