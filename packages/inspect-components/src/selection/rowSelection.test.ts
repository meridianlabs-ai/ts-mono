import { describe, expect, it } from "vitest";

import {
  kEmptyRowSelection,
  resolveSelected,
  resolveSelectedIds,
  toggleRowSelection,
} from "./rowSelection";

const order = ["a", "b", "c", "d", "e"];
const toggle = (
  state = kEmptyRowSelection,
  id: string,
  extend = false,
  visible = order
) => toggleRowSelection(state, visible, id, extend);

describe("toggleRowSelection", () => {
  it("toggles a single id and records it as the anchor", () => {
    const on = toggle(undefined, "b");
    expect([...on.selectedIds]).toEqual(["b"]);
    expect(on.lastToggledId).toBe("b");
    const off = toggle(on, "b");
    expect(off.selectedIds.size).toBe(0);
  });

  it("shift-click selects the contiguous range from the anchor, in either direction", () => {
    const range = toggle(toggle(undefined, "d"), "b", true);
    expect([...range.selectedIds].sort()).toEqual(["b", "c", "d"]);
    expect(range.lastToggledId).toBe("b");
  });

  it("shift-click on a selected row clears the whole range", () => {
    let state = toggle(undefined, "a");
    state = toggle(state, "d", true);
    expect(state.selectedIds.size).toBe(4);
    state = toggle(state, "a", true);
    expect(state.selectedIds.size).toBe(0);
  });

  it("ranges run over the visible rows only and keep hidden selections", () => {
    const visible = ["a", "b", "d", "e"];
    let state = toggle(undefined, "c");
    state = toggle(state, "a", false, visible);
    state = toggle(state, "d", true, visible);
    expect([...state.selectedIds].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to a single toggle when the anchor is not in the visible order", () => {
    const anchored = { selectedIds: new Set(["gone"]), lastToggledId: "gone" };
    const next = toggle(anchored, "c", true);
    expect([...next.selectedIds].sort()).toEqual(["c", "gone"]);
  });

  it("does not mutate the previous state", () => {
    const prev = { selectedIds: new Set(["a"]), lastToggledId: "a" };
    toggle(prev, "b");
    expect([...prev.selectedIds]).toEqual(["a"]);
  });
});

describe("resolveSelected / resolveSelectedIds", () => {
  const index = new Map([
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);

  it("resolve in index order, ignoring unknown ids", () => {
    const ids = new Set(["c", "zzz", "a"]);
    expect(resolveSelected(index, ids)).toEqual([1, 3]);
    expect(resolveSelectedIds(index, ids)).toEqual(["a", "c"]);
  });

  it("returns nothing for an empty selection", () => {
    expect(resolveSelected(index, new Set())).toEqual([]);
  });
});
