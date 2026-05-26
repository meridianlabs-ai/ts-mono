import { describe, expect, it } from "vitest";

import { hash32, hueForBranch } from "./branchColor";

describe("hash32", () => {
  it("is deterministic", () => {
    expect(hash32("alpha")).toBe(hash32("alpha"));
  });

  it("returns the FNV offset basis for an empty string", () => {
    expect(hash32("")).toBe(2166136261 >>> 0);
  });

  it("differs for different inputs", () => {
    expect(hash32("alpha")).not.toBe(hash32("beta"));
  });
});

describe("hueForBranch", () => {
  it("returns 210 for 'branch 1'", () => {
    expect(hueForBranch("branch 1")).toBe(210);
  });

  it("rotates by golden angle for sequential branches", () => {
    expect(hueForBranch("branch 2")).toBeCloseTo((210 + 137.5) % 360, 5);
    expect(hueForBranch("branch 3")).toBeCloseTo((210 + 2 * 137.5) % 360, 5);
  });

  it("wraps modulo 360 for high indexes", () => {
    const hue = hueForBranch("branch 13");
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
    expect(hue).toBeCloseTo((210 + 12 * 137.5) % 360, 5);
  });

  it("falls back to hash32 modulo 12 for non-numeric labels", () => {
    const idx = hash32("alpha") % 12;
    expect(hueForBranch("alpha")).toBeCloseTo((210 + idx * 137.5) % 360, 5);
  });

  it("handles trailing whitespace before the integer", () => {
    expect(hueForBranch("branch 2 ")).toBeCloseTo((210 + 137.5) % 360, 5);
  });
});
