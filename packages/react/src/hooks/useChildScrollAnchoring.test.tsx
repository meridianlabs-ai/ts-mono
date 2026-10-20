// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChildScrollAnchoring } from "./useChildScrollAnchoring";

let observer: CapturingResizeObserver | undefined;

class CapturingResizeObserver {
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test drives the observer the hook created
    observer = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Reports `target` at `blockSize` px tall, as a ResizeObserver would.
const resize = (target: Element, blockSize: number) => {
  if (!observer) {
    throw new Error("no observer");
  }
  const size = { blockSize, inlineSize: 100 };
  observer.callback(
    [
      {
        target,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
        contentRect: new DOMRectReadOnly(0, 0, 100, blockSize),
      } satisfies ResizeObserverEntry,
    ],
    observer
  );
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
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(5000);
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

  it("leaves the scroll position alone when a visible child grows", () => {
    const scrollTop = renderInScroller();
    const visible = screen.getByTestId("visible");
    resize(visible, 300);
    placeAt(visible, -100, 600);
    resize(visible, 600);
    expect(scrollTop.value).toBe(1000);
  });
});
