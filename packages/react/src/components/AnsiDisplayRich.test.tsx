// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CapturingIntersectionObserver,
  ResizeObserverStub,
} from "../test/dom-stubs";

import RichANSIDisplay from "./AnsiDisplayRich";
import { kChunkThreshold } from "./textChunks";

// Colored lines long enough to take the huge-output path.
const lines = Array.from(
  { length: Math.ceil(kChunkThreshold / 20) },
  (_, i) => `\u001b[31mline ${i}\u001b[0m tail`
);
const output = lines.join("\n");
const plainLines = lines.map((_, i) => `line ${i} tail`);

describe("RichANSIDisplay with huge output", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", CapturingIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows plain text chunks of every line, and colors a chunk once it nears the viewport", async () => {
    const { container } = render(<RichANSIDisplay output={output} />);
    const chunks = await waitFor(() => {
      const found = container.querySelectorAll("[data-chunk-container] > div");
      expect(found.length).toBeGreaterThan(1);
      return [...found];
    });
    expect(chunks.map((chunk) => chunk.textContent).join("\n")).toBe(
      plainLines.join("\n")
    );
    expect(container.querySelector("span[style]")).toBeNull();

    const second = chunks[1];
    if (!second) {
      throw new Error("expected a second chunk");
    }
    act(() => {
      CapturingIntersectionObserver.last?.intersect(second);
    });
    const colored = second.querySelectorAll("span[style]");
    expect(colored.length).toBeGreaterThan(0);
    expect(colored[0]?.getAttribute("style")).toContain("color");
    expect(chunks[0]?.querySelector("span[style]")).toBeNull();
  });

  it("shows a single huge line as chunked plain text", async () => {
    const line = `\u001b[32m${"x".repeat(kChunkThreshold * 2)}\u001b[0m`;
    const { container } = render(<RichANSIDisplay output={line} />);
    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-chunk-container] > *").length
      ).toBeGreaterThan(2);
    });
    expect(container.textContent).toBe("x".repeat(kChunkThreshold * 2));
  });
});
