// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { kSourceLinesAttribute } from "./markdownText";
import { renderedLineTop, sourceLinePosition } from "./segmentAnchor";

const placeAt = (element: Element, top: number, height: number) => {
  element.getBoundingClientRect = () => new DOMRect(0, top, 100, height);
};

const block = (tag: string, start: number, end: number, top: number) => {
  const element = document.createElement(tag);
  element.setAttribute(kSourceLinesAttribute, `${start} ${end}`);
  placeAt(element, top, 100);
  return element;
};

describe("sourceLinePosition", () => {
  it("is the offset's line plus how far along that line it is", () => {
    const source = "a\nbcde\nf";
    expect(sourceLinePosition(source, 0)).toBe(0);
    expect(sourceLinePosition(source, 4)).toBe(1.5);
    expect(sourceLinePosition(source, 7)).toBe(2);
  });
});

describe("renderedLineTop", () => {
  const segment = () => {
    const element = document.createElement("div");
    element.className = "markdown-segment";
    placeAt(element, 0, 400);
    // A one-line paragraph, a blank line, then a two-line list.
    element.append(block("p", 0, 1, 0), block("ul", 2, 4, 100));
    return element;
  };

  it("places a line through its block as far as it is through the block's lines", () => {
    expect(renderedLineTop(segment(), 0.9)).toBeCloseTo(90);
    expect(renderedLineTop(segment(), 3)).toBe(150);
  });

  it("places a blank line between blocks at the end of the block before it", () => {
    expect(renderedLineTop(segment(), 1.5)).toBe(100);
  });

  it("is unknown while the segment still shows its source", () => {
    const pending = segment();
    pending.classList.add("markdown-segment-pending");
    expect(renderedLineTop(pending, 0.5)).toBeUndefined();
  });
});
