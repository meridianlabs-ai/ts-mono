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
