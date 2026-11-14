// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRangeAboveView, scrollRangeIntoView } from "./findBandDom";

// jsdom has no layout. Each scroller gets a box, and its scrollTo moves the
// range and any nested scroller by the distance scrolled.
interface Box {
  top: number;
  height: number;
}

const RANGE_HEIGHT = 20;
let rangeTop = 0;
const boxes = new Map<Element, Box>();
const scrolls = new Map<Element, number>();

const scroller = (box: Box): HTMLDivElement => {
  const el = document.createElement("div");
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { value: 10_000 });
  Object.defineProperty(el, "clientHeight", { value: box.height });
  el.getBoundingClientRect = () => new DOMRect(0, box.top, 400, box.height);
  let scrollTop = 0;
  Object.defineProperty(el, "scrollTop", { get: () => scrollTop });
  el.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    scrolls.set(el, (scrolls.get(el) ?? 0) + 1);
    const top = typeof options === "number" ? options : (options?.top ?? 0);
    const delta = top - scrollTop;
    scrollTop = top;
    rangeTop -= delta;
    for (const inner of el.querySelectorAll("div")) {
      const innerBox = boxes.get(inner);
      if (innerBox) innerBox.top -= delta;
    }
  });
  boxes.set(el, box);
  return el;
};

const mountRange = (...nest: HTMLDivElement[]): Range => {
  let parent: HTMLElement = document.body;
  for (const el of nest) {
    parent.appendChild(el);
    parent = el;
  }
  const text = document.createTextNode("needle");
  parent.appendChild(text);
  const range = document.createRange();
  range.selectNodeContents(text);
  range.getBoundingClientRect = () =>
    new DOMRect(0, rangeTop, 50, RANGE_HEIGHT);
  return range;
};

afterEach(() => {
  document.body.innerHTML = "";
  boxes.clear();
  scrolls.clear();
});

describe("scrollRangeIntoView", () => {
  it("leaves a range that is already in view alone", () => {
    const outer = scroller({ top: 0, height: 600 });
    const range = mountRange(outer);
    rangeTop = 100;

    scrollRangeIntoView(range);

    expect(scrolls.get(outer)).toBeUndefined();
  });

  it("centres a clipped range in its scroller", () => {
    const outer = scroller({ top: 0, height: 600 });
    const range = mountRange(outer);
    rangeTop = 1500;

    scrollRangeIntoView(range);

    expect(rangeTop).toBe((600 - RANGE_HEIGHT) / 2);
  });

  it("scrolls the outer scroller when an inner one is off screen", () => {
    // A code panel that scrolls on its own, below the outer viewport.
    const outer = scroller({ top: 0, height: 600 });
    const inner = scroller({ top: 1200, height: 200 });
    const range = mountRange(outer, inner);
    rangeTop = 1250;

    scrollRangeIntoView(range);

    expect(scrolls.get(inner)).toBeUndefined();
    expect(rangeTop).toBeGreaterThanOrEqual(0);
    expect(rangeTop + RANGE_HEIGHT).toBeLessThanOrEqual(600);
  });

  it("scrolls the inner scroller when the range is clipped inside it", () => {
    const outer = scroller({ top: 0, height: 600 });
    const inner = scroller({ top: 100, height: 200 });
    const range = mountRange(outer, inner);
    rangeTop = 900;

    scrollRangeIntoView(range);

    expect(rangeTop).toBeGreaterThanOrEqual(100);
    expect(rangeTop + RANGE_HEIGHT).toBeLessThanOrEqual(300);
  });
});

describe("scrollRangeIntoView, horizontally", () => {
  it("scrolls a wide panel sideways to a match past its right edge", () => {
    const panel = document.createElement("div");
    panel.style.overflowX = "auto";
    Object.defineProperty(panel, "scrollWidth", { value: 5000 });
    Object.defineProperty(panel, "clientWidth", { value: 400 });
    panel.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    let scrollLeft = 0;
    Object.defineProperty(panel, "scrollLeft", { get: () => scrollLeft });
    let rangeLeft = 1200;
    panel.scrollTo = (options?: ScrollToOptions | number) => {
      const left =
        typeof options === "number" ? options : (options?.left ?? scrollLeft);
      rangeLeft -= left - scrollLeft;
      scrollLeft = left;
    };
    const range = mountRange(panel);
    range.getBoundingClientRect = () => new DOMRect(rangeLeft, 100, 50, 20);

    scrollRangeIntoView(range);

    expect(rangeLeft).toBeGreaterThanOrEqual(0);
    expect(rangeLeft + 50).toBeLessThanOrEqual(400);
  });
});

describe("scrollRangeIntoView, clipped by overflow: hidden", () => {
  it("scrolls an ellipsized title to a match past its edge", () => {
    const title = document.createElement("div");
    // jsdom doesn't expand the `overflow` shorthand; browsers do.
    title.style.overflowX = "hidden";
    title.style.overflowY = "hidden";
    Object.defineProperty(title, "scrollWidth", { value: 2000 });
    Object.defineProperty(title, "clientWidth", { value: 300 });
    title.getBoundingClientRect = () => new DOMRect(0, 0, 300, 20);
    let scrollLeft = 0;
    Object.defineProperty(title, "scrollLeft", { get: () => scrollLeft });
    let rangeLeft = 900;
    title.scrollTo = (options?: ScrollToOptions | number) => {
      const left =
        typeof options === "number" ? options : (options?.left ?? scrollLeft);
      rangeLeft -= left - scrollLeft;
      scrollLeft = left;
    };
    const range = mountRange(title);
    range.getBoundingClientRect = () => new DOMRect(rangeLeft, 0, 50, 20);

    scrollRangeIntoView(range);

    expect(rangeLeft).toBeGreaterThanOrEqual(0);
    expect(rangeLeft + 50).toBeLessThanOrEqual(300);
  });
});

describe("isRangeAboveView", () => {
  it("is true only above the innermost visible top", () => {
    const outer = scroller({ top: 50, height: 600 });
    const inner = scroller({ top: 100, height: 200 });
    const range = mountRange(outer, inner);

    rangeTop = 60;
    expect(isRangeAboveView(range)).toBe(true);
    rangeTop = 150;
    expect(isRangeAboveView(range)).toBe(false);
  });

  it("counts a range above the outer scroller's top as above the view", () => {
    // The inner panel is partly scrolled out past the outer viewport's top.
    const outer = scroller({ top: 300, height: 600 });
    const inner = scroller({ top: 100, height: 400 });
    const range = mountRange(outer, inner);

    rangeTop = 200;
    expect(isRangeAboveView(range)).toBe(true);
  });
});
