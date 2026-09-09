import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { debounce, throttle } from "./sync";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("throttle", () => {
  test("calls through on the leading edge and returns its result", () => {
    const fn = vi.fn((n: number) => n * 2);
    const throttled = throttle(fn, 100);

    expect(throttled(21)).toBe(42);
    expect(fn).toHaveBeenCalledExactlyOnceWith(21);
  });

  test("collapses calls inside the window into one trailing call", () => {
    const fn = vi.fn((n: number) => n);
    const throttled = throttle(fn, 100);

    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn.mock.calls).toEqual([[1]]);

    vi.advanceTimersByTime(100);
    // The trailing edge replays the most recent arguments, never a bare call.
    expect(fn.mock.calls).toEqual([[1], [3]]);
  });

  test("leading: false defers the first call to the trailing edge", () => {
    const fn = vi.fn((n: number) => n);
    const throttled = throttle(fn, 100, { leading: false });

    throttled(1);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledExactlyOnceWith(1);
  });

  test("a call after the window reopens invokes immediately", () => {
    const fn = vi.fn((n: number) => n);
    const throttled = throttle(fn, 100);

    throttled(1);
    vi.advanceTimersByTime(200);
    throttled(2);
    expect(fn.mock.calls).toEqual([[1], [2]]);
  });
});

describe("debounce", () => {
  test("waits out the window and calls with the last arguments", () => {
    const fn = vi.fn((n: number) => n);
    const debounced = debounce(fn, 100);

    debounced(1);
    debounced(2);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
  });

  test("leading fires immediately and not again on the trailing edge", () => {
    const fn = vi.fn((n: number) => n);
    const debounced = debounce(fn, 100, { leading: true });

    expect(debounced(1)).toBe(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  test("restarts the window on each call", () => {
    const fn = vi.fn((n: number) => n);
    const debounced = debounce(fn, 100);

    debounced(1);
    vi.advanceTimersByTime(60);
    debounced(2);
    vi.advanceTimersByTime(60);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
  });
});
