import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { JsonChange } from "@tsmono/inspect-common/types";

import { synthesizeComparable } from "./StateEventView";

const add = (path: string, value: JsonChange["value"]): JsonChange => ({
  op: "add",
  path,
  value,
  replaced: null,
});

describe("synthesizeComparable", () => {
  it("writes a nested add at its full path, not at the root", () => {
    const [before, after] = synthesizeComparable([add("/a/b", 1)]);
    expect(after).toEqual({ a: { b: 1 } });
    expect(before).toEqual({ a: {} });
  });

  it("merges prefix-sharing nested adds into one subtree", () => {
    const [, after] = synthesizeComparable([add("/a/b", 1), add("/a/c", 2)]);
    expect(after).toEqual({ a: { b: 1, c: 2 } });
  });

  it("creates arrays for numeric segments and pads earlier indexes", () => {
    const [before, after] = synthesizeComparable([add("/items/2", "x")]);
    expect(before).toEqual({ items: ["", ""] });
    expect(after).toEqual({ items: ["", "", "x"] });
  });

  it("shows replaced and new values at the same nested path", () => {
    const [before, after] = synthesizeComparable([
      { op: "replace", path: "/a/b", value: 2, replaced: 1 },
    ]);
    expect(before).toEqual({ a: { b: 1 } });
    expect(after).toEqual({ a: { b: 2 } });
  });

  it("keeps top-level changes at the root", () => {
    const [before, after] = synthesizeComparable([add("/a", 1)]);
    expect(before).toEqual({});
    expect(after).toEqual({ a: 1 });
  });

  // A Python dict with mixed numeric-string and non-numeric keys arrives as
  // sibling paths like /a/0 and /a/name; the numeric one alone looks like an
  // array index. Both values must survive as a plain object — string props
  // set on an array are invisible to JSON.stringify and the diff renderer.
  it("re-keys an array as an object when a non-numeric sibling key lands in it", () => {
    const [before, after] = synthesizeComparable([
      add("/a/0", "m"),
      add("/a/name", "y"),
    ]);
    expect(after).toEqual({ a: { 0: "m", name: "y" } });
    expect(before).toEqual({ a: {} });
  });

  it("keeps object entries when a numeric sibling key follows a non-numeric one", () => {
    const [, after] = synthesizeComparable([
      add("/a/name", "y"),
      add("/a/0", "m"),
    ]);
    expect(after).toEqual({ a: { name: "y", 0: "m" } });
  });

  // remove/move/copy write through setPath without initializeArrays, so a
  // mixed-key re-key can fire on one side only; the sides must still end up
  // with the same container kind or the diff renders as a whole-value swap.
  it("aligns container kinds across sides when an op re-keys only one side", () => {
    const [before, after] = synthesizeComparable([
      add("/a/0", "m"),
      { op: "remove", path: "/a/name", value: "y", replaced: null },
    ]);
    expect(before).toEqual({ a: { name: "y" } });
    expect(after).toEqual({ a: { 0: "m" } });
  });
});

// Numeric path segments come from the log. Padding an array out to one must
// cost work proportional to the change list, not to the number in the path,
// or a single `/x/2000000000` change freezes the viewer.
describe("synthesizeComparable array index bounds", () => {
  const kHugeIndex = "1000000";

  // Checked before any toEqual so a regression fails on a number instead of
  // diff-printing a million-element array.
  const serializedSize = (
    sides: [Record<string, unknown>, Record<string, unknown>]
  ) => JSON.stringify(sides).length;

  it("keeps a huge add index as an object key instead of padding to it", () => {
    const sides = synthesizeComparable([add(`/x/${kHugeIndex}`, 1)]);
    expect(serializedSize(sides)).toBeLessThan(100);
    expect(sides).toEqual([{ x: {} }, { x: { [kHugeIndex]: 1 } }]);
  });

  it("keeps a huge replace index as an object key on both sides", () => {
    const sides = synthesizeComparable([
      { op: "replace", path: `/x/${kHugeIndex}`, value: 2, replaced: 1 },
    ]);
    expect(serializedSize(sides)).toBeLessThan(100);
    expect(sides).toEqual([
      { x: { [kHugeIndex]: 1 } },
      { x: { [kHugeIndex]: 2 } },
    ]);
  });

  it("bounds a huge index in a middle segment", () => {
    const sides = synthesizeComparable([add(`/x/${kHugeIndex}/y`, 1)]);
    expect(serializedSize(sides)).toBeLessThan(100);
    expect(sides).toEqual([
      { x: { [kHugeIndex]: {} } },
      { x: { [kHugeIndex]: { y: 1 } } },
    ]);
  });

  // remove/move/copy skip padding, so the write itself mustn't leave a
  // holey array whose length is the log's number.
  it("does not grow a sparse array for a huge remove index", () => {
    const sides = synthesizeComparable([
      { op: "remove", path: `/x/${kHugeIndex}`, value: 1, replaced: null },
    ]);
    expect(serializedSize(sides)).toBeLessThan(100);
    expect(sides).toEqual([{ x: { [kHugeIndex]: 1 } }, {}]);
  });

  it("bounds total padding across many moderately indexed changes", () => {
    const changes = Array.from({ length: 200 }, (_, i) =>
      add(`/list${i}/999`, i)
    );
    const sides = synthesizeComparable(changes);
    expect(serializedSize(sides)).toBeLessThan(100_000);
    const [, after] = sides;
    expect(after["list0"]).toEqual([...Array<string>(999).fill(""), 0]);
    expect(after["list199"]).toEqual({ 999: 199 });
  });

  // Both sides pad from one budget; if only `before` could afford an index,
  // reconciling would turn its padding into thousands of phantom deletions.
  it("pads both sides as arrays for an index within the budget", () => {
    const [before, after] = synthesizeComparable([add("/a/9000", 1)]);
    expect(before).toEqual({ a: Array<string>(9000).fill("") });
    expect(after).toEqual({ a: [...Array<string>(9000).fill(""), 1] });
  });

  it("gives both sides the same container kind once the budget runs out", () => {
    const [before, after] = synthesizeComparable([
      add("/a/6000", 1),
      add("/b/6000", 2),
    ]);
    expect(Array.isArray(before["a"]) && Array.isArray(after["a"])).toBe(true);
    expect(before["b"]).toEqual({});
    expect(after["b"]).toEqual({ 6000: 2 });
  });

  // jsonpatch emits one add per new list element; the side that isn't
  // written trails by one each time, and catching it up mustn't be charged.
  it("keeps a list grown by many appends as an array on both sides", () => {
    const count = 12_000;
    const [before, after] = synthesizeComparable(
      Array.from({ length: count }, (_, i) => add(`/items/${i}`, i))
    );
    expect(Array.isArray(before["items"])).toBe(true);
    expect(after["items"]).toEqual(Array.from({ length: count }, (_, i) => i));
  });

  it("keeps earlier elements when an over-budget index re-keys an array", () => {
    const [, after] = synthesizeComparable([
      add("/a/0", "x"),
      add(`/a/${kHugeIndex}`, "y"),
    ]);
    expect(after).toEqual({ a: { 0: "x", [kHugeIndex]: "y" } });
  });

  it("bounds a huge index in a move's from path", () => {
    const sides = synthesizeComparable([
      {
        op: "move",
        path: "/y",
        from: `/x/${kHugeIndex}`,
        value: 1,
        replaced: null,
      },
    ]);
    expect(serializedSize(sides)).toBeLessThan(100);
    expect(sides).toEqual([{ x: { [kHugeIndex]: 1 } }, { y: 1 }]);
  });

  it("keeps arrays that grow one element per change as arrays", () => {
    const [before, after] = synthesizeComparable([
      add("/items/0", "a"),
      add("/items/1", "b"),
    ]);
    expect(before).toEqual({ items: [""] });
    expect(after).toEqual({ items: ["a", "b"] });
  });
});

// Paths come straight from the log. A `__proto__` segment must become an
// ordinary key in the synthesized tree, never a step into Object.prototype:
// a write there would be read back by every plain object in the page.
describe("synthesizeComparable prototype safety", () => {
  // If the code under test regresses, remove whatever it planted so the
  // leak doesn't poison later tests in this worker.
  let prototypeKeys: Set<string>;
  beforeEach(() => {
    prototypeKeys = new Set(Object.getOwnPropertyNames(Object.prototype));
  });
  afterEach(() => {
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      if (!prototypeKeys.has(key))
        Reflect.deleteProperty(Object.prototype, key);
    }
  });

  it("stores a __proto__ segment as an own key instead of writing the prototype", () => {
    const [before, after] = synthesizeComparable([
      add("/__proto__/planted_add", "x"),
    ]);
    expect(Object.hasOwn(Object.prototype, "planted_add")).toBe(false);
    // A re-parented `after` would serialize as {}.
    expect(JSON.stringify(after)).toBe('{"__proto__":{"planted_add":"x"}}');
    expect(JSON.stringify(before)).toBe('{"__proto__":{}}');
  });

  it("keeps a replace through __proto__ off the prototype on both sides", () => {
    synthesizeComparable([
      {
        op: "replace",
        path: "/__proto__/planted_replace",
        value: "new",
        replaced: "old",
      },
    ]);
    expect(Object.hasOwn(Object.prototype, "planted_replace")).toBe(false);
  });

  // Never a vector (a function fails the container check), kept as a guard
  // on the own-property walk should that check ever loosen.
  it("does not reach Object.prototype through constructor/prototype", () => {
    const [, after] = synthesizeComparable([
      add("/constructor/prototype/planted_ctor", "x"),
    ]);
    expect(Object.hasOwn(Object.prototype, "planted_ctor")).toBe(false);
    expect(JSON.stringify(after)).toBe(
      '{"constructor":{"prototype":{"planted_ctor":"x"}}}'
    );
  });
});
