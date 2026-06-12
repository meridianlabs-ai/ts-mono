import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createPolling } from "./polling";

describe("createPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("calls back after interval when callback returns true", async () => {
    const cb = vi.fn().mockResolvedValue(true);
    const p = createPolling("t", cb, { maxRetries: 3, interval: 2 });

    p.start();
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));

    // Before the interval elapses, still only 1 call.
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    // After 2s total, a second call is scheduled.
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(2);

    p.stop();
  });

  test("re-enters immediately when callback returns 'immediate'", async () => {
    let count = 0;
    const cb = vi.fn().mockImplementation(() => {
      count += 1;
      return Promise.resolve(count < 3 ? "immediate" : true);
    });
    const p = createPolling("t", cb, { maxRetries: 3, interval: 2 });

    p.start();

    // "immediate" schedules via setTimeout(0) so the renderer and GC can run
    // between iterations. Advance past each zero-delay tick until the three
    // back-to-back calls have happened.
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1);
      expect(cb).toHaveBeenCalledTimes(3);
    });

    // After the third call returns `true` (normal cadence), no further call
    // should happen on a zero-delay tick — it waits the full 2s interval.
    await vi.advanceTimersByTimeAsync(1);
    expect(cb).toHaveBeenCalledTimes(3);

    p.stop();
  });

  test("stops when callback returns false", async () => {
    const cb = vi.fn().mockResolvedValue(false);
    const p = createPolling("t", cb, { maxRetries: 3, interval: 2 });

    p.start();
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
