// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMirrorToStore } from "./useMirrorToStore";

describe("useMirrorToStore", () => {
  it("writes the initial value and each change, not re-renders", () => {
    const write = vi.fn();
    const { rerender } = renderHook(
      ({ value }: { value: string | undefined }) =>
        useMirrorToStore(value, write),
      { initialProps: { value: "a" } }
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith("a");

    rerender({ value: "a" });
    expect(write).toHaveBeenCalledTimes(1);

    rerender({ value: "b" });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("b");
  });

  it("never writes undefined, so the store keeps the last value", () => {
    const write = vi.fn();
    const initialProps: { value: string | undefined } = { value: undefined };
    const { rerender } = renderHook(
      ({ value }: { value: string | undefined }) =>
        useMirrorToStore(value, write),
      { initialProps }
    );
    expect(write).not.toHaveBeenCalled();

    rerender({ value: "a" });
    rerender({ value: undefined });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith("a");
  });

  it("calls the latest write function without re-running on its change", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ value, write }: { value: number; write: (v: number) => void }) =>
        useMirrorToStore(value, write),
      { initialProps: { value: 1, write: first } }
    );
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ value: 1, write: second });
    expect(second).not.toHaveBeenCalled();

    rerender({ value: 2, write: second });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith(2);
  });
});
