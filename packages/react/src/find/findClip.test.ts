// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { rangeExceedsFold } from "./findClip";
import { variantsPattern } from "./useFindHighlights";

describe("rangeExceedsFold", () => {
  it("false when the range sits inside the collapsed height", () => {
    const clip = document.createElement("div");
    clip.getBoundingClientRect = () => new DOMRect(0, 0, 400, 80);
    const range = document.createRange();
    range.getClientRects = vi.fn<() => DOMRectList>().mockReturnValue(
      Object.assign([new DOMRect(0, 20, 40, 16)], {
        item: (i: number) => (i === 0 ? new DOMRect(0, 20, 40, 16) : null),
      })
    );
    expect(rangeExceedsFold(clip, range, 80)).toBe(false);
  });

  it("true when the range sits below the collapsed height", () => {
    const clip = document.createElement("div");
    clip.getBoundingClientRect = () => new DOMRect(0, 0, 400, 80);
    const range = document.createRange();
    range.getClientRects = vi.fn<() => DOMRectList>().mockReturnValue(
      Object.assign([new DOMRect(0, 120, 40, 16)], {
        item: (i: number) => (i === 0 ? new DOMRect(0, 120, 40, 16) : null),
      })
    );
    expect(rangeExceedsFold(clip, range, 80)).toBe(true);
  });
});

describe("variantsPattern", () => {
  it("matches the longest text first", () => {
    const re = variantsPattern(["ca", "café"]);
    expect("café".match(re)?.[0]).toBe("café");
  });
});
