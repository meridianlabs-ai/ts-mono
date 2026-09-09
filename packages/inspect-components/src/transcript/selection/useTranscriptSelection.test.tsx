// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { testInfoEvent } from "@tsmono/inspect-common/testing";

import { useTranscriptSelection } from "./useTranscriptSelection";

afterEach(cleanup);

const events = [testInfoEvent({ uuid: "a" }), testInfoEvent({ uuid: "b" })];

describe("useTranscriptSelection", () => {
  it("resets the mode and the selection when the key changes", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useTranscriptSelection(key, events),
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
    const { result } = renderHook(() => useTranscriptSelection("k", events));
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

  it("resolves the selected events on demand", () => {
    const { result } = renderHook(() => useTranscriptSelection("k", events));
    act(() => result.current.toggleActive());
    act(() =>
      result.current.selection?.onChange({
        selectedIds: new Set(["b"]),
        lastToggledId: "b",
      })
    );
    expect(result.current.resolveSelected()).toEqual([events[1]]);
  });
});
