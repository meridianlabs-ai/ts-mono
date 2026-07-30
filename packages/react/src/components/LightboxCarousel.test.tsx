// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FC, ReactNode, useState, useSyncExternalStore } from "react";
import { describe, expect, it } from "vitest";

import {
  ComponentStateHooks,
  ComponentStateProvider,
} from "../state/ComponentStateContext";

import { ComponentIconProvider, ComponentIcons } from "./ComponentIconContext";
import { LightboxCarousel } from "./LightboxCarousel";

// Reactive Map-backed store: LightboxCarousel drives every piece of its state
// through useProperty, so setValue has to actually re-render for the lightbox
// to open or the slide to advance.
function makeStateHooks(): ComponentStateHooks {
  const store = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  const key = (id: string, prop: string) => `${id}::${prop}`;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const emit = () => listeners.forEach((listener) => listener());

  return {
    useValue: (id: string, prop: string, defaultValue?: unknown) =>
      useSyncExternalStore(subscribe, () => {
        const k = key(id, prop);
        return store.has(k) ? store.get(k) : defaultValue;
      }),
    useSetValue: () => (id: string, prop: string, value: unknown) => {
      store.set(key(id, prop), value);
      emit();
    },
    useRemoveValue: () => (id: string, prop: string) => {
      store.delete(key(id, prop));
      emit();
    },
    useEntries: () => undefined,
    useRemoveAll: () => () => {},
    useRemoveByPrefix: () => () => {},
  };
}

const icons: ComponentIcons = {
  arrowDown: "icon-arrowDown",
  arrowUp: "icon-arrowUp",
  chevronDown: "icon-chevronDown",
  chevronUp: "icon-chevronUp",
  clearText: "icon-clearText",
  close: "icon-close",
  code: "icon-code",
  confirm: "icon-confirm",
  copy: "icon-copy",
  error: "icon-error",
  menu: "icon-menu",
  next: "icon-next",
  noSamples: "icon-noSamples",
  play: "icon-play",
  previous: "icon-previous",
  toggleRight: "icon-toggleRight",
};

const Wrapper: FC<{ children: ReactNode }> = ({ children }) => {
  const [hooks] = useState(makeStateHooks);
  return (
    <ComponentStateProvider hooks={hooks}>
      <ComponentIconProvider icons={icons}>{children}</ComponentIconProvider>
    </ComponentStateProvider>
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
  // only attaches once isOpen is true — gate on the "open" class instead.
  await waitFor(() => {
    expect(screen.getByText("slide-0-body")).toBeTruthy();
    expect(document.querySelector(".open")).toBeTruthy();
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
