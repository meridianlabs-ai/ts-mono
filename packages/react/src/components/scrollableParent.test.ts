// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { findScrollableParent } from "./scrollableParent";

// jsdom doesn't lay out, so scroll sizes are set by hand.
const scroller = (overflowY: string, scrollHeight: number): HTMLDivElement => {
  const element = document.createElement("div");
  element.style.overflowY = overflowY;
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight });
  Object.defineProperty(element, "clientHeight", { value: 200 });
  return element;
};

describe("findScrollableParent", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  test("returns null when no ancestor scrolls", () => {
    const child = document.createElement("div");
    container.appendChild(child);
    expect(findScrollableParent(child)).toBeNull();
  });

  test.each(["auto", "scroll"])(
    "finds an ancestor with overflow-y: %s",
    (overflowY) => {
      const scrollable = scroller(overflowY, 500);
      const child = document.createElement("div");
      scrollable.appendChild(child);
      container.appendChild(scrollable);
      expect(findScrollableParent(child)).toBe(scrollable);
    }
  );

  test("skips an ancestor with nothing to scroll", () => {
    const outer = scroller("auto", 500);
    const inner = scroller("auto", 200);
    const child = document.createElement("div");
    inner.appendChild(child);
    outer.appendChild(inner);
    container.appendChild(outer);
    expect(findScrollableParent(child)).toBe(outer);
  });

  test("finds the nearest of several", () => {
    const outer = scroller("auto", 1_000);
    const inner = scroller("auto", 500);
    const child = document.createElement("div");
    inner.appendChild(child);
    outer.appendChild(inner);
    container.appendChild(outer);
    expect(findScrollableParent(child)).toBe(inner);
  });

  test("starts from the parent of a non-HTML element", () => {
    const scrollable = scroller("auto", 500);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    scrollable.appendChild(svg);
    container.appendChild(scrollable);
    expect(findScrollableParent(svg)).toBe(scrollable);
  });
});
