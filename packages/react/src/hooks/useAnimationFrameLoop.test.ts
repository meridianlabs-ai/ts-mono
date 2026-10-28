// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAnimationFrameLoop } from "./useAnimationFrameLoop";

describe("useAnimationFrameLoop", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;
  const runFrame = (now: number) => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(now);
  };

  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes seconds since the previous frame, starting from 0", () => {
    const callback = vi.fn();
    renderHook(() => useAnimationFrameLoop(callback, true));

    runFrame(1000);
    runFrame(1016);
    runFrame(1066);
    expect(callback.mock.calls).toEqual([
      [0, 1000],
      [0.016, 1016],
      [0.05, 1066],
    ]);
  });

  it("stops while inactive and doesn't count the time stopped", () => {
    const callback = vi.fn();
    const initialProps = { active: true };
    const { rerender } = renderHook(
      ({ active }) => useAnimationFrameLoop(callback, active),
      { initialProps }
    );
    runFrame(0);
    rerender({ active: false });
    runFrame(500);
    expect(callback).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    runFrame(5000);
    runFrame(5010);
    expect(callback.mock.calls.slice(1)).toEqual([
      [0, 5000],
      [0.01, 5010],
    ]);
  });

  it("cancels its frame on unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useAnimationFrameLoop(callback, true));
    unmount();
    expect(frames.size).toBe(0);
  });
});
