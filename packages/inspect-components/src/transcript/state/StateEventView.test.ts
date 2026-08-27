import { describe, expect, it } from "vitest";

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
    const [, after] = synthesizeComparable([
      add("/a/b", 1),
      add("/a/c", 2),
    ]);
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
});
