// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpaceBelow } from "./useSpaceBelow";

describe("useSpaceBelow", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const elementAt = (top: number, bottom: number) => {
    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      new DOMRect(0, top, 100, bottom - top);
    return element;
  };

  it("measures from the element's top to the container's bottom", () => {
    const element = elementAt(250, 2000);
    const container = elementAt(0, 900);
    const { result } = renderHook(() =>
      useSpaceBelow({ current: element }, { current: container })
    );
    expect(result.current).toBe(650);

    element.getBoundingClientRect = () => new DOMRect(0, 150, 100, 1000);
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(750);
  });

  it("is 0 before the elements mount", () => {
    const { result } = renderHook(() =>
      useSpaceBelow({ current: null }, { current: null })
    );
    expect(result.current).toBe(0);
  });
});
