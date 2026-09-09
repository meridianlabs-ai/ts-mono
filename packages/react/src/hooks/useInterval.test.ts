// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterval } from "./useInterval";

describe("useInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the callback every delayMs", () => {
    const callback = vi.fn();
    renderHook(() => useInterval(callback, 100));

    vi.advanceTimersByTime(350);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("does not tick when delayMs is null", () => {
    const callback = vi.fn();
    renderHook(() => useInterval(callback, null));

    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("pauses and resumes when delayMs toggles null", () => {
    const callback = vi.fn();
    const initialProps: { delay: number | null } = { delay: 100 };
    const { rerender } = renderHook(
      ({ delay }) => useInterval(callback, delay),
      { initialProps }
    );

    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);

    rerender({ delay: null });
    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(1);

    rerender({ delay: 100 });
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("always calls the latest callback without resetting the interval", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useInterval(fn, 100), {
      initialProps: { fn: first },
    });

    vi.advanceTimersByTime(100);
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ fn: second });
    vi.advanceTimersByTime(100);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops on unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useInterval(callback, 100));

    unmount();
    vi.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();
  });
});
