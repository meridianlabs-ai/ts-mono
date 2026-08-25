import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import { useListPositionManager } from "./useListPositionManager";

const stateHooks = vi.hoisted(() => ({
  removeByPrefix: vi.fn(),
  removeValue: vi.fn(),
}));

vi.mock("@tsmono/react/state", () => ({
  useComponentStateHooks: () => ({
    useRemoveByPrefix: () => stateHooks.removeByPrefix,
    useRemoveValue: () => stateHooks.removeValue,
  }),
}));

describe("useListPositionManager", () => {
  it("does not reset scroll when a consumed target changes without a selection change", () => {
    const scrollTo = vi.fn();
    const scrollRef: RefObject<HTMLDivElement | null> = {
      current: { scrollTo } as unknown as HTMLDivElement,
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
