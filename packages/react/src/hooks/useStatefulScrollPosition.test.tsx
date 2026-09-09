// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "../state/ComponentStateContext";
import { makeReactiveStateStore } from "../test/component-state-hooks";

import { useStatefulScrollPosition } from "./useStatefulScrollPosition";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Harness({
  el,
  elementKey,
}: {
  el: HTMLDivElement;
  elementKey: string;
}) {
  const ref = useRef<HTMLDivElement | null>(el);
  useStatefulScrollPosition(ref, elementKey, 1000);
  return null;
}

const makeScrollable = () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
};

describe("useStatefulScrollPosition", () => {
  it("stores the debounced scroll position under the element key", () => {
    vi.useFakeTimers();
    const { hooks, store } = makeReactiveStateStore();
    const el = makeScrollable();
    render(
      <ComponentStateProvider hooks={hooks}>
        <Harness el={el} elementKey="panel" />
      </ComponentStateProvider>
    );

    el.scrollTop = 800;
    act(() => {
      el.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(1100);
    });

    expect(store.get("scrollPosition::panel")).toBe(800);
  });

  it("stores the position captured at event time when the trailing tick lands after unmount", () => {
    vi.useFakeTimers();
    const { hooks, store } = makeReactiveStateStore();
    const el = makeScrollable();
    const { unmount } = render(
      <ComponentStateProvider hooks={hooks}>
        <Harness el={el} elementKey="panel" />
      </ComponentStateProvider>
    );

    el.scrollTop = 800;
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    unmount();
    // A detached element's scrollTop reads 0; the pending tick must store
    // the value captured when the scroll event fired, not re-read it now.
    el.scrollTop = 0;
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(store.get("scrollPosition::panel")).toBe(800);
  });
});
