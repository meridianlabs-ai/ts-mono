// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useManualTitleCollapse } from "./useManualTitleCollapse";

describe("useManualTitleCollapse", () => {
  it("follows scrolling until the user chooses a state", () => {
    const { result, rerender } = renderHook(
      ({ autoCollapsed }) =>
        useManualTitleCollapse(autoCollapsed, "first.eval"),
      { initialProps: { autoCollapsed: false } }
    );

    rerender({ autoCollapsed: true });
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.setCollapsed(false));
    rerender({ autoCollapsed: true });
    expect(result.current.collapsed).toBe(false);
  });

  it("returns to scroll-driven state for a different log", () => {
    const { result, rerender } = renderHook(
      ({ scope, autoCollapsed }) =>
        useManualTitleCollapse(autoCollapsed, scope),
      { initialProps: { scope: "first.eval", autoCollapsed: true } }
    );

    act(() => result.current.setCollapsed(false));
    rerender({ scope: "second.eval", autoCollapsed: true });

    expect(result.current.collapsed).toBe(true);
  });
  it("does not restore an old manual choice after visiting another log", () => {
    const { result, rerender } = renderHook(
      ({ scope }) => useManualTitleCollapse(false, scope),
      { initialProps: { scope: "first.eval" } }
    );

    act(() => result.current.setCollapsed(true));
    expect(result.current.collapsed).toBe(true);

    rerender({ scope: "second.eval" });
    expect(result.current.collapsed).toBe(false);

    rerender({ scope: "first.eval" });
    expect(result.current.collapsed).toBe(false);
  });
});
