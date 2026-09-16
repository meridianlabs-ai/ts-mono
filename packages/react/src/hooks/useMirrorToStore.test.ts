// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MirrorKey,
  useMirrorKeyedToStore,
  useMirrorToStore,
} from "./useMirrorToStore";

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

describe("useMirrorKeyedToStore", () => {
  it("writes on the first key and on each element-wise change only", () => {
    const write = vi.fn();
    const { rerender } = renderHook(
      ({ key }: { key: MirrorKey | undefined }) =>
        useMirrorKeyedToStore(key, write),
      { initialProps: { key: ["run.eval", "s1", "2"] } }
    );
    expect(write).toHaveBeenCalledTimes(1);

    // A new array with equal elements is the same key.
    rerender({ key: ["run.eval", "s1", "2"] });
    expect(write).toHaveBeenCalledTimes(1);

    rerender({ key: ["run.eval", "s1", "3"] });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("keeps elements of different types apart", () => {
    const write = vi.fn();
    const initialProps: { key: MirrorKey | undefined } = {
      key: ["run.eval", 1],
    };
    const { rerender } = renderHook(
      ({ key }: { key: MirrorKey | undefined }) =>
        useMirrorKeyedToStore(key, write),
      { initialProps }
    );
    rerender({ key: ["run.eval", "1"] });
    rerender({ key: ["run.eval", undefined] });
    rerender({ key: ["run.eval", ""] });
    expect(write).toHaveBeenCalledTimes(4);
  });

  it("never writes for an undefined key", () => {
    const write = vi.fn();
    const initialProps: { key: MirrorKey | undefined } = { key: undefined };
    const { rerender } = renderHook(
      ({ key }: { key: MirrorKey | undefined }) =>
        useMirrorKeyedToStore(key, write),
      { initialProps }
    );
    expect(write).not.toHaveBeenCalled();

    rerender({ key: ["run.eval"] });
    rerender({ key: undefined });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("calls the latest write closure", () => {
    const seen: string[] = [];
    const { rerender } = renderHook(
      ({ key, label }: { key: MirrorKey; label: string }) =>
        useMirrorKeyedToStore(key, () => seen.push(label)),
      { initialProps: { key: ["a"], label: "first" } }
    );
    rerender({ key: ["a"], label: "stale" });
    rerender({ key: ["b"], label: "second" });
    expect(seen).toEqual(["first", "second"]);
  });
});
