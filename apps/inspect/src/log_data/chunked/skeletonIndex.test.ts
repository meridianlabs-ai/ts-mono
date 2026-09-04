import { afterEach, describe, expect, it } from "vitest";

import { SkeletonIndex } from "./skeletonIndex";
import type { SampleSkeleton, SkeletonSpan } from "./types";

const span = (id: string, begin: number, parent?: number): SkeletonSpan => ({
  id,
  ...(parent !== undefined ? { parent } : {}),
  name: id,
  begin,
  extent: [begin, begin + 1],
  t: ["2024-01-01T00:00:00+00:00", "2024-01-01T00:00:00+00:00"],
  working: [0, 0],
  events: 2,
  models: 0,
  gap_models: [0],
  children: {},
});

const skeletonOf = (spans: SkeletonSpan[]): SampleSkeleton => ({
  version: 1,
  counts: { events: 0, models: 0 },
  spans,
  notables: [],
  overflow: {},
});

// skeleton.json is JSON.parse'd straight into SampleSkeleton, so `parent`
// can hold any JSON value at runtime. Reflect.set plants such a value on a
// well-typed span without lying to the compiler about the type.
const withRawParent = (s: SkeletonSpan, parent: unknown): SkeletonSpan => {
  const copy = { ...s };
  Reflect.set(copy, "parent", parent);
  return copy;
};

describe("SkeletonIndex", () => {
  afterEach(() => {
    // A leaked push onto Array.prototype would poison every later test:
    // reset before asserting so the failure stays contained.
    const leaked = Array.prototype.length;
    Array.prototype.length = 0;
    expect(leaked).toBe(0);
    expect([][0]).toBeUndefined();
  });

  it("indexes children under their parent and roots at the top", () => {
    const skel = new SkeletonIndex(
      skeletonOf([span("root", 0), span("child", 1, 0), span("other", 4)])
    );
    expect(skel.roots).toEqual([0, 2]);
    expect(skel.childrenOf).toEqual([[1], [], []]);
    expect(skel.spanStackAt(1)).toEqual([0, 1]);
  });

  it.each([
    ["__proto__", "__proto__"],
    ["constructor", "constructor"],
    ["length", "length"],
    ["a negative index", -1],
    ["a fractional index", 0.5],
    ["a self reference", 1],
    ["a forward reference", 2],
    ["an out-of-range index", 99],
    ["null", null],
  ])(
    "rejects a span whose parent is %s without touching Array.prototype",
    (_, parent) => {
      const spans = [
        span("root", 0),
        withRawParent(span("child", 1), parent),
        span("tail", 4),
      ];
      expect(() => new SkeletonIndex(skeletonOf(spans))).toThrow(/parent/);
      expect(Object.hasOwn(Array.prototype, "0")).toBe(false);
    }
  );
});
