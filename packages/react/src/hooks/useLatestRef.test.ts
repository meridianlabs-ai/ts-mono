// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useLatestRef } from "./useLatestRef";

describe("useLatestRef", () => {
  it("holds the initial value after mount", () => {
    const { result } = renderHook(() => useLatestRef(1));
    expect(result.current.current).toBe(1);
  });

  it("tracks the latest value across re-renders with a stable ref", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLatestRef(value),
      { initialProps: { value: "a" } }
    );
    const ref = result.current;

    rerender({ value: "b" });
    expect(result.current).toBe(ref);
    expect(ref.current).toBe("b");

    rerender({ value: "c" });
    expect(ref.current).toBe("c");
  });
});
