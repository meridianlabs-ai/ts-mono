// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrustedContentWrapper } from "../test/content-trust";
import {
  CapturingIntersectionObserver,
  ResizeObserverStub,
} from "../test/dom-stubs";

import { MarkdownDiv } from "./MarkdownDiv";
import { kChunkThreshold } from "./textChunks";

const section = (i: number) =>
  `## Section ${i}\n\nParagraph ${i} with **bold** text.\n\n- item ${i}\n\n`;
const markdown = Array.from(
  { length: Math.ceil(kChunkThreshold / section(0).length) + 50 },
  (_, i) => section(i)
).join("");

describe("MarkdownDiv with a huge document", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", CapturingIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a segment's markdown once it nears the viewport, and shows its source until then", async () => {
    const { container } = render(<MarkdownDiv markdown={markdown} />, {
      wrapper: TrustedContentWrapper,
    });
    const segments = await waitFor(() => {
      const found = [...container.querySelectorAll(".markdown-segment")];
      expect(found.length).toBeGreaterThan(3);
      return found;
    });
    const middle = segments[Math.floor(segments.length / 2)];
    if (!middle) {
      throw new Error("expected a middle segment");
    }
    expect(middle.querySelector("h2, strong")).toBeNull();
    expect(middle.textContent).toMatch(
      /## Section \d+\n\nParagraph \d+ with \*\*bold\*\* text\./
    );

    act(() => {
      CapturingIntersectionObserver.last?.intersect(middle);
    });
    expect(middle.querySelector("h2")?.textContent).toMatch(/^Section \d+$/);
    expect(middle.querySelector("strong")?.textContent).toBe("bold");
    // The edge segments always render.
    expect(segments[0]?.querySelector("h2")?.textContent).toBe("Section 0");
  });

  it("shows the segments at once when the same document mounts again", async () => {
    const first = render(<MarkdownDiv markdown={markdown} />, {
      wrapper: TrustedContentWrapper,
    });
    await waitFor(() => {
      expect(first.container.querySelector(".markdown-segment")).not.toBeNull();
    });
    first.unmount();

    const { container } = render(<MarkdownDiv markdown={markdown} />, {
      wrapper: TrustedContentWrapper,
    });
    expect(
      container.querySelectorAll(".markdown-segment").length
    ).toBeGreaterThan(3);
  });

  it("keeps showing a remounted document's segments after other documents push it out of the cache", async () => {
    const doc = (name: string) => `# ${name}\n\n${markdown}`;
    const segmented = async (text: string) => {
      const view = render(<MarkdownDiv markdown={text} />, {
        wrapper: TrustedContentWrapper,
      });
      await waitFor(() => {
        expect(
          view.container.querySelector(".markdown-segment")
        ).not.toBeNull();
      });
      return view;
    };
    (await segmented(doc("A"))).unmount();
    const remounted = await segmented(doc("A"));
    for (const other of ["B", "C", "D"]) {
      (await segmented(doc(other))).unmount();
    }

    remounted.rerender(<MarkdownDiv markdown={doc("A")} onClick={() => {}} />);
    expect(
      remounted.container.querySelectorAll(".markdown-segment").length
    ).toBeGreaterThan(3);
  });
});
