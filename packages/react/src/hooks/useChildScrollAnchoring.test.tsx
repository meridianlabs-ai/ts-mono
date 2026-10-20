// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CapturingResizeObserver } from "../test/dom-stubs";

import {
  ScrollAnchor,
  useChildScrollAnchoring,
} from "./useChildScrollAnchoring";

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

const anchor: { current: ScrollAnchor | null } = { current: null };

const Chunks = () => {
  const ref = useRef<HTMLDivElement>(null);
  useChildScrollAnchoring(ref, "text", anchor);
  return (
    <div ref={ref}>
      <div data-testid="above" />
      <div data-testid="visible" />
    </div>
  );
};

interface ScrollerOptions {
  /** As VirtualList does, so the browser doesn't anchor these children. */
  anchoringOff?: boolean;
  /** Wrap the chunks in a VirtualList row placed here. */
  row?: { top: number; height: number };
}

const renderInScroller = ({
  anchoringOff = true,
  row,
}: ScrollerOptions = {}) => {
  const scrollTop = { value: 1000 };
  render(
    <div
      data-testid="scroller"
      style={{
        overflowY: "auto",
        overflowAnchor: anchoringOff ? "none" : undefined,
      }}
    >
      {row ? (
        <div data-index={0} data-testid="row">
          <Chunks />
        </div>
      ) : (
        <Chunks />
      )}
    </div>
  );
  if (row) {
    placeAt(screen.getByTestId("row"), row.top, row.height);
  }
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
    anchor.current = null;
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

  it("leaves a scroller the browser anchors natively to the browser", () => {
    const scrollTop = renderInScroller({ anchoringOff: false });
    const above = screen.getByTestId("above");
    resize(above, 300);
    placeAt(above, -800, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1000);
  });

  it("leaves a VirtualList row entirely above the viewport to the virtualizer", () => {
    // The row ended 100px above the viewport before its child grew by 300.
    const scrollTop = renderInScroller({ row: { top: -1400, height: 1600 } });
    const above = screen.getByTestId("above");
    resize(above, 300);
    placeAt(above, -1400, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1000);
  });

  it("compensates inside a VirtualList row that reaches into the viewport", () => {
    const scrollTop = renderInScroller({ row: { top: -1400, height: 2000 } });
    const above = screen.getByTestId("above");
    resize(above, 300);
    placeAt(above, -1400, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1300);
  });

  it("keeps an anchor inside a changed child still, rather than what follows the child", () => {
    const scrollTop = renderInScroller();
    const above = screen.getByTestId("above");
    resize(above, 300);
    // The anchored line was 250px down the viewport; the change moved it to
    // 400px, though the child grew by 300.
    anchor.current = {
      target: above,
      top: 250,
      scrollTop: 1000,
      locate: () => 400,
    };
    placeAt(above, -100, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1150);
    expect(anchor.current).toBeNull();
  });

  it("keeps an anchor where scrolling since it was captured has moved it", () => {
    const scrollTop = renderInScroller();
    const above = screen.getByTestId("above");
    resize(above, 300);
    anchor.current = {
      target: above,
      top: 250,
      scrollTop: 1000,
      locate: () => 400,
    };
    // Scrolled down 100px after the anchor was captured: the anchor belongs
    // at 150px now.
    scrollTop.value = 1100;
    placeAt(above, -100, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1350);
  });

  it("compensates as usual while an anchor can't be located yet", () => {
    const scrollTop = renderInScroller();
    const above = screen.getByTestId("above");
    resize(above, 300);
    anchor.current = {
      target: above,
      top: 250,
      scrollTop: 1000,
      locate: () => undefined,
    };
    placeAt(above, -100, 600);
    resize(above, 600);
    expect(scrollTop.value).toBe(1300);
    expect(anchor.current).not.toBeNull();
  });
});
