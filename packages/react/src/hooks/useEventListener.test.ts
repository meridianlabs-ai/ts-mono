// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEventListener } from "./useEventListener";

describe("useEventListener", () => {
  it("receives events dispatched on a window target", () => {
    const listener = vi.fn();
    renderHook(() => useEventListener(window, "resize", listener));

    window.dispatchEvent(new Event("resize"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("receives events on an element passed via ref", () => {
    const element = document.createElement("div");
    const ref = { current: element };
    const listener = vi.fn();
    renderHook(() => useEventListener(ref, "click", listener));

    element.dispatchEvent(new Event("click"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a null target", () => {
    const listener = vi.fn();
    renderHook(() => useEventListener(null, "resize", listener));

    window.dispatchEvent(new Event("resize"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("calls the latest listener without re-subscribing", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ fn }) => useEventListener(window, "resize", fn),
      { initialProps: { fn: first } }
    );
    const subscriptions = addSpy.mock.calls.filter(
      ([type]) => type === "resize"
    ).length;

    rerender({ fn: second });
    window.dispatchEvent(new Event("resize"));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls.filter(([type]) => type === "resize").length).toBe(
      subscriptions
    );
    addSpy.mockRestore();
  });

  it("unsubscribes on unmount", () => {
    const listener = vi.fn();
    const { unmount } = renderHook(() =>
      useEventListener(window, "resize", listener)
    );

    unmount();
    window.dispatchEvent(new Event("resize"));
    expect(listener).not.toHaveBeenCalled();
  });
});
