// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CapturingIntersectionObserver } from "../test/dom-stubs";

import { useRevealedChildren } from "./useRevealedChildren";

const intersect = (target: Element) => {
  act(() => {
    CapturingIntersectionObserver.last?.intersect(target);
  });
};

const Chunks = ({ chunksKey }: { chunksKey: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useRevealedChildren(ref, chunksKey);
  return (
    <div ref={ref}>
      {[0, 1, 2].map((index) => (
        <div key={index} data-testid={`chunk-${index}`}>
          {revealed.has(index) ? "rich" : "plain"}
        </div>
      ))}
    </div>
  );
};

describe("useRevealedChildren", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", CapturingIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reveals each child that comes near the viewport, and keeps it revealed", () => {
    render(<Chunks chunksKey="a" />);
    expect(screen.getByTestId("chunk-1").textContent).toBe("plain");

    intersect(screen.getByTestId("chunk-1"));
    expect(screen.getByTestId("chunk-1").textContent).toBe("rich");
    expect(screen.getByTestId("chunk-0").textContent).toBe("plain");
    expect(
      CapturingIntersectionObserver.last?.observed.has(
        screen.getByTestId("chunk-1")
      )
    ).toBe(false);

    intersect(screen.getByTestId("chunk-2"));
    expect(screen.getByTestId("chunk-1").textContent).toBe("rich");
    expect(screen.getByTestId("chunk-2").textContent).toBe("rich");
  });

  it("starts over when the children change", () => {
    const { rerender } = render(<Chunks chunksKey="a" />);
    intersect(screen.getByTestId("chunk-0"));
    expect(screen.getByTestId("chunk-0").textContent).toBe("rich");

    rerender(<Chunks chunksKey="b" />);
    expect(screen.getByTestId("chunk-0").textContent).toBe("plain");
  });
});
