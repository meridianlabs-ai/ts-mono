// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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

  it("ArrowRight/ArrowLeft fire onNext/onPrevious; Shift+L does not", () => {
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
    // The Shift+H/L chord binding was removed; it must not navigate.
    press("L", { shiftKey: true });
    expect(onNext).toHaveBeenCalledTimes(1);
    press("H", { shiftKey: true });
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("chevrons expose accessible names (aria-label, without the shortcut suffix)", () => {
    // Screen readers must announce the control, not the "(←)" tooltip
    // decoration — and a caller that omits tooltips still gets a name.
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
    expect(
      screen.getByRole("button", { name: "Previous result" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next result" })).toBeTruthy();
    cleanup();

    render(
      <NextPreviousNav
        hasPrevious
        hasNext
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
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

const renderNav = (hrefs: { previousHref?: string; nextHref?: string }) => {
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  render(
    <NextPreviousNav
      onPrevious={onPrevious}
      onNext={onNext}
      hasPrevious={false}
      hasNext
      previousTitle="Previous sample"
      nextTitle="Next sample"
      {...hrefs}
    />
  );
  return {
    previous: screen.getByLabelText("Previous sample"),
    next: screen.getByLabelText("Next sample"),
    onPrevious,
    onNext,
  };
};

const click = (el: HTMLElement, init: MouseEventInit) => {
  const event = createEvent.click(el, init);
  fireEvent(el, event);
  return event.defaultPrevented;
};

describe("NextPreviousNav links", () => {
  const hrefs = { previousHref: "#/s/1", nextHref: "#/s/3" };

  it("renders an enabled chevron with an href as a link to it", () => {
    const { next } = renderNav(hrefs);
    expect(next.tagName).toBe("A");
    expect(next.getAttribute("href")).toBe("#/s/3");
  });

  it("renders a disabled chevron as a disabled link with nowhere to go", () => {
    const { previous } = renderNav(hrefs);
    expect(previous.tagName).toBe("A");
    expect(previous.hasAttribute("href")).toBe(false);
    expect(previous.getAttribute("role")).toBe("link");
    expect(previous.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps keyboard focus when the focused chevron becomes disabled", () => {
    const props = { onPrevious: vi.fn(), onNext: vi.fn(), hasPrevious: true };
    const { rerender } = render(
      <NextPreviousNav
        {...props}
        hasNext
        previousHref="#/s/1"
        nextHref="#/s/3"
        nextTitle="Next sample"
      />
    );
    const next = screen.getByLabelText("Next sample");
    next.focus();
    // Stepping onto the last sample: Next has nowhere to go.
    rerender(
      <NextPreviousNav
        {...props}
        hasNext={false}
        previousHref="#/s/2"
        nextTitle="Next sample"
      />
    );
    expect(screen.getByLabelText("Next sample")).toBe(next);
    expect(document.activeElement).toBe(next);
  });

  it("steps in place on a plain click", () => {
    const { next, onNext } = renderNav(hrefs);
    expect(click(next, { button: 0 })).toBe(true);
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("leaves cmd/ctrl-click to the browser", () => {
    const { next, onNext } = renderNav(hrefs);
    expect(click(next, { button: 0, metaKey: true })).toBe(false);
    expect(click(next, { button: 0, ctrlKey: true })).toBe(false);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("steps on Space like the div chevrons", () => {
    const { next, onNext } = renderNav(hrefs);
    fireEvent.keyDown(next, { key: " " });
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("keeps the div chevrons without hrefs", () => {
    const { next, onNext } = renderNav({});
    expect(next.tagName).toBe("DIV");
    fireEvent.keyDown(next, { key: "Enter" });
    expect(onNext).toHaveBeenCalledOnce();
  });
});
