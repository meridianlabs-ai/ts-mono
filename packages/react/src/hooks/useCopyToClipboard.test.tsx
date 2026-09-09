// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCopyToClipboard } from "./useCopyToClipboard";

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCopyToClipboard", () => {
  it("flips copied after the write resolves and clears it after the delay", async () => {
    vi.useFakeTimers();
    let resolveWrite: () => void = () => {};
    const writeText = vi.fn(
      () => new Promise<void>((resolve) => (resolveWrite = resolve))
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(() => useCopyToClipboard(1000));

    await act(async () => {
      result.current.copy("hello");
      await flush();
    });
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(false);

    await act(async () => {
      resolveWrite();
      await flush();
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);
  });

  it("re-arms the confirm timer on a second copy", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });
    const { result } = renderHook(() => useCopyToClipboard(1000));
    await act(async () => {
      result.current.copy("one");
      await flush();
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    await act(async () => {
      result.current.copy("two");
      await flush();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.copied).toBe(false);
  });

  it("stays uncopied when the write rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
    });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      result.current.copy("hello");
      await flush();
    });
    expect(result.current.copied).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
