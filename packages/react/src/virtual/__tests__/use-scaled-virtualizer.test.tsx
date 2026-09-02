// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScaledVirtualizer } from "../use-scaled-virtualizer";

describe("useScaledVirtualizer scroll observation", () => {
  const onscrollend = Object.getOwnPropertyDescriptor(window, "onscrollend");
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (onscrollend) Object.defineProperty(window, "onscrollend", onscrollend);
  });

  const mount = () => {
    const el = document.createElement("div");
    el.scrollTo = () => {};
    document.body.appendChild(el);
    const { result } = renderHook(() =>
      useScaledVirtualizer({
        count: 3,
        estimateSize: () => 400,
        getScrollElement: () => el,
      })
    );
    return { el, result };
  };

  it("clears isScrolling without a scrollend event (Safari < 26)", () => {
    Reflect.deleteProperty(window, "onscrollend");
    const { el, result } = mount();
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.virtualizer.isScrolling).toBe(true);
    act(() => {
      vi.advanceTimersByTime(
        result.current.virtualizer.options.isScrollingResetDelay
      );
    });
    expect(result.current.virtualizer.isScrolling).toBe(false);
  });

  it("waits for scrollend where the browser fires it", () => {
    const { el, result } = mount();
    act(() => {
      el.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.virtualizer.isScrolling).toBe(true);
    act(() => {
      el.dispatchEvent(new Event("scrollend"));
    });
    expect(result.current.virtualizer.isScrolling).toBe(false);
  });
});
