// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useRowSelection } from "./useRowSelection";

afterEach(cleanup);

const rows = new Map([
  ["a", "row a"],
  ["b", "row b"],
]);
const resolve = (ids: ReadonlySet<string>) =>
  [...rows].filter(([id]) => ids.has(id)).map(([, row]) => row);

describe("useRowSelection", () => {
  it("resets the mode and the selection when the key changes", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRowSelection(key, resolve),
      { initialProps: { key: "t1:events@v1" } }
    );
    act(() => result.current.toggleActive());
    act(() =>
      result.current.selection?.onChange({
        selectedIds: new Set(["a"]),
        lastToggledId: "a",
      })
    );
    expect(result.current.active).toBe(true);
    expect(result.current.selectedCount).toBe(1);

    rerender({ key: "t1:messages@v2" });
    expect(result.current.active).toBe(false);
    expect(result.current.selectedCount).toBe(0);

    // Returning is a new visit, so it starts unlatched too.
    rerender({ key: "t1:events@v3" });
    expect(result.current.active).toBe(false);
  });

  it("clear keeps the mode; clearAndExit leaves it", () => {
    const { result } = renderHook(() => useRowSelection("k", resolve));
    act(() => result.current.toggleActive());
    act(() =>
      result.current.selection?.onChange({
        selectedIds: new Set(["a", "b"]),
        lastToggledId: "b",
      })
    );
    act(() => result.current.clear());
    expect(result.current.active).toBe(true);
    expect(result.current.selectedCount).toBe(0);
    act(() => result.current.toggleActive());
    act(() => result.current.toggleActive());
    act(() => result.current.clearAndExit());
    expect(result.current.active).toBe(false);
  });

  it("resolves the selected rows on demand", () => {
    const { result } = renderHook(() => useRowSelection("k", resolve));
    act(() => result.current.toggleActive());
    act(() =>
      result.current.selection?.onChange({
        selectedIds: new Set(["b"]),
        lastToggledId: "b",
      })
    );
    expect(result.current.resolveSelected()).toEqual(["row b"]);
  });
});
