// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ComponentStateProvider } from "../state/ComponentStateContext";
import { makeReactiveStateStore } from "../test/component-state-hooks";

import { useVirtualListState } from "./use-virtual-list-state";

const restoreWith = (stored: unknown, enabled = true) => {
  const { hooks, store } = makeReactiveStateStore();
  store.set("list::snapshot", stored);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ComponentStateProvider hooks={hooks}>{children}</ComponentStateProvider>
  );
  const { result } = renderHook(() => useVirtualListState("list", enabled), {
    wrapper,
  });
  return result.current.getRestoreSnapshot();
};

describe("useVirtualListState", () => {
  it("restores a current snapshot", () => {
    const snapshot = { version: 1, scrollOffset: 120, totalCount: 40 };
    expect(restoreWith(snapshot)).toEqual(snapshot);
  });

  it("ignores a snapshot from another version", () => {
    expect(
      restoreWith({ version: 0, scrollOffset: 120, totalCount: 40 })
    ).toBeUndefined();
  });

  it("ignores a malformed stored value", () => {
    expect(restoreWith({ version: 1, scrollOffset: "120" })).toBeUndefined();
    expect(restoreWith("stale")).toBeUndefined();
  });

  it("restores nothing when disabled", () => {
    expect(
      restoreWith({ version: 1, scrollOffset: 120, totalCount: 40 }, false)
    ).toBeUndefined();
  });
});
