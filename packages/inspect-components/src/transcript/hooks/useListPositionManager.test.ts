// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import { useListPositionManager } from "./useListPositionManager";

describe("useListPositionManager", () => {
  it("does not reset scroll when a consumed target changes without a selection change", () => {
    const scrollTo = vi.fn();
    const scrollElement = document.createElement("div");
    Object.defineProperty(scrollElement, "scrollTo", { value: scrollTo });
    const scrollRef: RefObject<HTMLDivElement | null> = {
      current: scrollElement,
    };

    const { rerender } = renderHook(
      ({ selected, hasScrollTarget }) =>
        useListPositionManager("sample", selected, scrollRef, hasScrollTarget),
      {
        initialProps: {
          selected: "root",
          hasScrollTarget: false,
        },
      }
    );

    rerender({ selected: "root/branch-a", hasScrollTarget: true });
    expect(scrollTo).not.toHaveBeenCalled();

    rerender({ selected: "root/branch-a", hasScrollTarget: false });
    expect(scrollTo).not.toHaveBeenCalled();

    rerender({ selected: "root/branch-b", hasScrollTarget: false });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });
});
