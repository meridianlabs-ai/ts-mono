// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FC, ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "../state/ComponentStateContext";
import { makeReactiveStateHooks } from "../test/component-state-hooks";

import { LightboxCarousel } from "./LightboxCarousel";
import styles from "./LightboxCarousel.module.css";

// LightboxCarousel drives every piece of its state through useProperty, so a
// set has to actually re-render for the lightbox to open or the slide to
// advance.
const Wrapper: FC<{ children: ReactNode }> = ({ children }) => {
  const [hooks] = useState(makeReactiveStateHooks);
  return (
    <ComponentStateProvider hooks={hooks}>{children}</ComponentStateProvider>
  );
};

const slides = [
  { label: "first", render: () => <div>slide-0-body</div> },
  { label: "second", render: () => <div>slide-1-body</div> },
];

// The component listens on window, and fireEvent's synthesized keyboard event
// does not carry `key` through to a window-targeted listener — dispatch a real
// KeyboardEvent instead.
function pressKey(key: string) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true })
    );
  });
}

async function renderOpened() {
  const view = render(
    <Wrapper>
      <LightboxCarousel id="lightbox" slides={slides} />
    </Wrapper>
  );
  fireEvent.click(screen.getByText("first"));
  // openLightbox defers setIsOpen behind a 10ms timer so the fade starts from
  // opacity 0, but the overlay (and slide body) render as soon as showOverlay
  // flips. Waiting on the body alone would race the keyboard effect, which
  // only attaches once isOpen is true — gate on the open class instead.
  await waitFor(() => {
    expect(screen.getByText("slide-0-body")).toBeTruthy();
    expect(document.querySelector(`.${styles.open}`)).toBeTruthy();
  });
  return view;
}

describe("LightboxCarousel", () => {
  it("removes its window keyup listener on unmount", async () => {
    const { unmount } = await renderOpened();
    unmount();

    // The handler unconditionally calls preventDefault, so a surviving
    // listener is observable as a cancelled event. It was registered with
    // capture, and removeEventListener only matches when capture matches.
    const escape = new KeyboardEvent("keyup", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(false);
  });

  it("wraps to the first slide when advancing past the last", async () => {
    await renderOpened();

    pressKey("ArrowRight");
    expect(screen.getByText("slide-1-body")).toBeTruthy();

    pressKey("ArrowRight");
    expect(screen.getByText("slide-0-body")).toBeTruthy();
  });

  it("wraps to the last slide when going back from the first", async () => {
    await renderOpened();

    pressKey("ArrowLeft");
    expect(screen.getByText("slide-1-body")).toBeTruthy();
  });
});

describe("LightboxCarousel fade-out", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderOpenedWithFakeTimers() {
    render(
      <Wrapper>
        <LightboxCarousel id="lightbox" slides={slides} />
      </Wrapper>
    );
    fireEvent.click(screen.getByText("first"));
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(document.querySelector(`.${styles.open}`)).toBeTruthy();
  }

  it("keeps the overlay mounted for the full fade-out after closing", () => {
    renderOpenedWithFakeTimers();
    pressKey("Escape");

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.getByText("slide-0-body")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("slide-0-body")).toBeNull();
  });

  it("cancels the pending removal when reopened mid-fade", () => {
    renderOpenedWithFakeTimers();
    pressKey("Escape");
    act(() => {
      vi.advanceTimersByTime(100);
    });

    fireEvent.click(screen.getByText("first"));
    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector(`.${styles.open}`)).toBeTruthy();
    expect(screen.getByText("slide-0-body")).toBeTruthy();
  });
});
