// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTimeout } from "./useTimeout";

describe("useTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the callback once after delayMs", () => {
    const callback = vi.fn();
    renderHook(() => useTimeout(callback, 100));

    vi.advanceTimersByTime(99);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not fire when delayMs is null", () => {
    const callback = vi.fn();
    renderHook(() => useTimeout(callback, null));

    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("cancels a pending timer when delayMs becomes null", () => {
    const callback = vi.fn();
    const initialProps: { delay: number | null } = { delay: 100 };
    const { rerender } = renderHook(
      ({ delay }) => useTimeout(callback, delay),
      { initialProps }
    );

    vi.advanceTimersByTime(50);
    rerender({ delay: null });
    vi.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();
  });

  it("cancels on unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useTimeout(callback, 100));

    unmount();
    vi.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();
  });
});
