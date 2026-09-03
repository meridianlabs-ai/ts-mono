// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOnClickOutside } from "./useOnClickOutside";

const mousedown = (target: EventTarget) => {
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
};

describe("useOnClickOutside", () => {
  let inside: HTMLDivElement;
  let outside: HTMLDivElement;

  beforeEach(() => {
    inside = document.createElement("div");
    outside = document.createElement("div");
    document.body.append(inside, outside);
  });
  afterEach(() => {
    inside.remove();
    outside.remove();
  });

  it("calls the handler for a press outside the element", () => {
    const handler = vi.fn();
    renderHook(() => useOnClickOutside({ current: inside }, handler));

    mousedown(outside);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores presses inside the element", () => {
    const handler = vi.fn();
    renderHook(() => useOnClickOutside({ current: inside }, handler));

    mousedown(inside);
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores everything when the ref is empty", () => {
    const handler = vi.fn();
    renderHook(() => useOnClickOutside({ current: null }, handler));

    mousedown(outside);
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useOnClickOutside({ current: inside }, handler)
    );

    unmount();
    mousedown(outside);
    expect(handler).not.toHaveBeenCalled();
  });
});
