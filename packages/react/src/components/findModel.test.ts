// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  buildEntries,
  keyAt,
  ordinalOf,
  rangeOf,
  SourceMatches,
  totalMatches,
} from "./findModel";

const ranges = (n: number): Range[] =>
  Array.from({ length: n }, () => document.createRange());

const source = (overrides: Partial<SourceMatches> = {}): SourceMatches => ({
  id: "list",
  position: 0,
  dataCounts: [],
  rendered: new Map(),
  renderedItems: new Set(),
  ...overrides,
});

describe("buildEntries", () => {
  it("splices a list's items in at its position among page matches", () => {
    const page = ranges(3);
    const entries = buildEntries(page, [
      source({ position: 1, dataCounts: [{ item: 4, count: 2 }] }),
    ]);
    expect(entries.map((e) => [e.source, e.item, e.count])).toEqual([
      [null, 0, 1],
      ["list", 4, 2],
      [null, 1, 1],
      [null, 2, 1],
    ]);
    expect(totalMatches(entries)).toBe(5);
  });

  it("counts a rendered item's DOM matches instead of its data count", () => {
    const dom = ranges(2);
    const entries = buildEntries(
      [],
      [
        source({
          dataCounts: [
            { item: 1, count: 3 },
            { item: 2, count: 2 },
          ],
          rendered: new Map([[1, dom]]),
          renderedItems: new Set([1]),
        }),
      ]
    );
    expect(entries.map((e) => [e.item, e.count, e.ranges])).toEqual([
      [1, 2, dom],
      [2, 2, null],
    ]);
  });

  it("drops a rendered item that shows none of its data matches", () => {
    const entries = buildEntries(
      [],
      [
        source({
          dataCounts: [{ item: 1, count: 3 }],
          renderedItems: new Set([1]),
        }),
      ]
    );
    expect(entries).toEqual([]);
  });

  it("keeps a rendered item's DOM matches that its data doesn't count", () => {
    const dom = ranges(2);
    const entries = buildEntries(
      [],
      [source({ rendered: new Map([[7, dom]]), renderedItems: new Set([7]) })]
    );
    expect(entries.map((e) => [e.item, e.count])).toEqual([[7, 2]]);
  });
});

describe("buildEntries at scale", () => {
  it("handles a list with hundreds of thousands of matching items", () => {
    const dataCounts = Array.from({ length: 300_000 }, (_, item) => ({
      item,
      count: 1,
    }));
    const entries = buildEntries([], [source({ dataCounts })]);
    expect(totalMatches(entries)).toBe(300_000);
  });
});

describe("match keys", () => {
  const dom = ranges(2);
  const entries = buildEntries(ranges(1), [
    source({
      position: 1,
      dataCounts: [
        { item: 0, count: 2 },
        { item: 5, count: 3 },
      ],
      rendered: new Map([[0, dom]]),
      renderedItems: new Set([0]),
    }),
  ]);

  it("numbers matches across entries and wraps at both ends", () => {
    expect(keyAt(entries, 0)).toEqual({ source: null, item: 0, occurrence: 0 });
    expect(keyAt(entries, 2)).toEqual({
      source: "list",
      item: 0,
      occurrence: 1,
    });
    expect(keyAt(entries, 5)).toEqual({
      source: "list",
      item: 5,
      occurrence: 2,
    });
    expect(keyAt(entries, 6)).toEqual(keyAt(entries, 0));
    expect(keyAt(entries, -1)).toEqual(keyAt(entries, 5));
  });

  it("round-trips ordinals and clamps an occurrence past the item's count", () => {
    for (let ordinal = 0; ordinal < 6; ordinal++) {
      expect(ordinalOf(entries, keyAt(entries, ordinal)!)).toBe(ordinal);
    }
    expect(ordinalOf(entries, { source: "list", item: 5, occurrence: 9 })).toBe(
      5
    );
    expect(ordinalOf(entries, { source: "list", item: 3, occurrence: 0 })).toBe(
      null
    );
  });

  it("gives a range only for rendered matches", () => {
    expect(rangeOf(entries, { source: "list", item: 0, occurrence: 1 })).toBe(
      dom[1]
    );
    expect(rangeOf(entries, { source: "list", item: 5, occurrence: 0 })).toBe(
      null
    );
  });

  it("has no key when nothing matches", () => {
    expect(keyAt([], 0)).toBe(null);
  });
});
