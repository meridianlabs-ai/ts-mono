// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextPreviousNav } from "./NextPreviousNav";

afterEach(cleanup);

const press = (key: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));

describe("NextPreviousNav arrow navigation", () => {
  it("appends the arrow shortcut to the tooltips", () => {
    render(
      <NextPreviousNav
        hasPrevious
        hasNext
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        previousTitle="Previous result"
        nextTitle="Next result"
      />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]?.title).toBe("Previous result (←)");
    expect(buttons[1]?.title).toBe("Next result (→)");
  });

  it("ArrowRight/ArrowLeft fire onNext/onPrevious; the retired Shift+L chord does not", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(
      <NextPreviousNav
        hasPrevious
        hasNext
        onPrevious={onPrevious}
        onNext={onNext}
      />
    );
    press("ArrowRight");
    expect(onNext).toHaveBeenCalledTimes(1);
    press("ArrowLeft");
    expect(onPrevious).toHaveBeenCalledTimes(1);
    // User decree (t.60): the Shift+H/L chord system is removed — the chord
    // must no longer navigate.
    press("L", { shiftKey: true });
    expect(onNext).toHaveBeenCalledTimes(1);
    press("H", { shiftKey: true });
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("a disabled chevron's arrow key is a no-op (tooltip still advertises it)", () => {
    const onNext = vi.fn();
    render(
      <NextPreviousNav
        hasPrevious={false}
        hasNext={false}
        onPrevious={vi.fn()}
        onNext={onNext}
        nextTitle="Next result"
      />
    );
    expect(screen.getAllByRole("button")[1]?.title).toBe("Next result (→)");
    press("ArrowRight");
    expect(onNext).not.toHaveBeenCalled();
  });
});
