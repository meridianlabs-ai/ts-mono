// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useScaledVirtualizer } from "../use-scaled-virtualizer";

// jsdom has no layout, so give the element a writable scrollTop that, like a
// browser, does not notify listeners until a scroll event is dispatched.
const scrollerAt = (top: number) => {
  const el = document.createElement("div");
  let scrollTop = top;
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  const scrollTo = vi.fn();
  el.scrollTo = scrollTo;
  return { el, scrollTo };
};

// A shared container still scrolled to the previous view's position, reset
// to the top by a direct scrollTop write.
const mountThenResetToTop = () => {
  const { el, scrollTo } = scrollerAt(17_304);
  const { result } = renderHook(() =>
    useScaledVirtualizer({
      count: 50,
      estimateSize: () => 300,
      getScrollElement: () => el,
    })
  );
  el.scrollTop = 0;
  scrollTo.mockClear();
  return { result, scrollTo };
};

describe("useScaledVirtualizer syncScrollOffset", () => {
  it("without a sync, a row resize scrolls back toward the previous offset", () => {
    const { result, scrollTo } = mountThenResetToTop();

    result.current.virtualizer.resizeItem(0, 500);

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 17_504 })
    );
  });

  it("after a sync, a row resize leaves the reset position alone", () => {
    const { result, scrollTo } = mountThenResetToTop();

    result.current.syncScrollOffset();
    result.current.virtualizer.resizeItem(0, 500);

    expect(result.current.virtualizer.scrollOffset).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
