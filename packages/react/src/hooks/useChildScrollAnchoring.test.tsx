// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CapturingResizeObserver } from "../test/dom-stubs";

import { useChildScrollAnchoring } from "./useChildScrollAnchoring";

// Reports `target` at `blockSize` px tall, as a ResizeObserver would.
const resize = (target: Element, blockSize: number) => {
  const observer = CapturingResizeObserver.last;
  if (!observer) {
    throw new Error("no observer");
  }
  observer.resize(target, blockSize);
};

const placeAt = (element: Element, top: number, height: number) => {
  element.getBoundingClientRect = () => new DOMRect(0, top, 100, height);
};

const Chunks = () => {
  const ref = useRef<HTMLDivElement>(null);
  useChildScrollAnchoring(ref, "text");
  return (
    <div ref={ref}>
      <div data-testid="above" />
      <div data-testid="visible" />
    </div>
  );
};

const renderInScroller = () => {
  const scrollTop = { value: 1000 };
  render(
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <Chunks />
    </div>
  );
  const scroller = screen.getByTestId("scroller");
  Object.defineProperty(scroller, "scrollTop", {
    get: () => scrollTop.value,
    set: (value: number) => {
      scrollTop.value = value;
    },
  });
  placeAt(scroller, 0, 500);
  return scrollTop;
};

describe("useChildScrollAnchoring", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", CapturingResizeObserver);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
      5000
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scrolls by the growth of a child that was entirely above the viewport", () => {
    const scrollTop = renderInScroller();
    const above = screen.getByTestId("above");
    resize(above, 300);
    placeAt(above, -800, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1300);
  });

  it("scrolls by the growth of a child straddling the viewport's top edge", () => {
    const scrollTop = renderInScroller();
    const above = screen.getByTestId("above");
    resize(above, 300);
    placeAt(above, -100, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1300);
  });

  it("leaves the scroll position alone when a child starting in view grows", () => {
    const scrollTop = renderInScroller();
    const visible = screen.getByTestId("visible");
    resize(visible, 300);
    placeAt(visible, 50, 600);
    resize(visible, 600);
    expect(scrollTop.value).toBe(1000);
  });

  it("anchors once the container becomes scrollable after mounting", () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(400);
    const scrollTop = renderInScroller();
    const above = screen.getByTestId("above");
    resize(above, 300);

    // A collapsed panel expands: now the scroller scrolls.
    scrollHeight.mockReturnValue(5000);
    placeAt(above, -800, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1300);
  });
});
