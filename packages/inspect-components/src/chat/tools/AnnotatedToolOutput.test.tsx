// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  AnnotatedToolOutput,
  renderHtmlAnnotation,
  renderSvgAnnotation,
  type ToolAnnotation,
} from "./AnnotatedToolOutput";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
});

describe("AnnotatedToolOutput", () => {
  it("renders children unchanged when there is no annotation", () => {
    render(
      <AnnotatedToolOutput>
        <span>child-content</span>
      </AnnotatedToolOutput>
    );
    expect(screen.getByText("child-content")).toBeDefined();
  });

  it("renders children inside a relative container when annotated", () => {
    const annotation: ToolAnnotation = {
      action: "left_click",
      coordinate: [10, 20],
    };
    const { container } = render(
      <AnnotatedToolOutput annotation={annotation}>
        <span>child-content</span>
      </AnnotatedToolOutput>
    );
    expect(screen.getByText("child-content")).toBeDefined();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.position).toBe("relative");
  });
});

describe("renderSvgAnnotation", () => {
  it("draws a ring + cursor for click actions at a coordinate", () => {
    const { container } = render(
      <svg>
        {renderSvgAnnotation(
          { action: "left_click", coordinate: [10, 20] },
          1,
          1
        )}
      </svg>
    );
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("path")).not.toBeNull();
  });

  it("draws a down arrow for scroll actions", () => {
    const { container } = render(
      <svg>
        {renderSvgAnnotation(
          { action: "scroll", coordinate: [5, 5], scrollDirection: "down" },
          1,
          1
        )}
      </svg>
    );
    expect(container.querySelector("text")?.textContent).toBe("\u2193");
  });

  it("returns null for click actions without a coordinate", () => {
    expect(renderSvgAnnotation({ action: "left_click" }, 1, 1)).toBeNull();
  });

  it("returns null for keyboard actions", () => {
    expect(renderSvgAnnotation({ action: "type", text: "x" }, 1, 1)).toBeNull();
  });
});

describe("renderHtmlAnnotation", () => {
  it("renders a badge with the typed text for type actions", () => {
    const { container } = render(
      <>{renderHtmlAnnotation({ action: "type", text: "hello world" })}</>
    );
    expect(container.textContent).toContain("hello world");
  });

  it("renders a badge for key actions", () => {
    const { container } = render(
      <>{renderHtmlAnnotation({ action: "key", text: "Enter" })}</>
    );
    expect(container.textContent).toContain("Enter");
  });

  it("returns null for non-keyboard actions", () => {
    expect(renderHtmlAnnotation({ action: "left_click" })).toBeNull();
  });
});
