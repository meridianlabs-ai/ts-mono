// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMountEffect } from "./useMountEffect";

describe("useMountEffect", () => {
  it("runs the effect once on mount and not on re-renders", () => {
    const effect = vi.fn();
    const { rerender } = renderHook(() => useMountEffect(effect));

    expect(effect).toHaveBeenCalledTimes(1);

    rerender();
    rerender();
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("runs the returned cleanup on unmount only", () => {
    const cleanup = vi.fn();
    const { rerender, unmount } = renderHook(() =>
      useMountEffect(() => cleanup)
    );

    rerender();
    expect(cleanup).not.toHaveBeenCalled();

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
