// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useUnmount } from "./useUnmount";

describe("useUnmount", () => {
  it("does not call fn on mount or re-renders", () => {
    const fn = vi.fn();
    const { rerender } = renderHook(() => useUnmount(fn));

    rerender();
    rerender();
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls fn once on unmount", () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useUnmount(fn));

    unmount();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls the latest fn from the final render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ fn }) => useUnmount(fn), {
      initialProps: { fn: first },
    });

    rerender({ fn: second });
    unmount();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
