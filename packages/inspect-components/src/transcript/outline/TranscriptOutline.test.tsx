// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testErrorEvent } from "@tsmono/inspect-common/testing";
import {
  ComponentStateProvider,
  type ComponentStateHooks,
} from "@tsmono/react/state";
import { makeReactiveStateHooks } from "@tsmono/react/testing";

import { EventNode } from "../types";

import { outlineNodeRunning, TranscriptOutline } from "./TranscriptOutline";

describe("outlineNodeRunning", () => {
  it("marks the last node running when live", () => {
    expect(
      outlineNodeRunning({ running: true, backfilling: false, isLast: true })
    ).toBe(true);
  });

  it("never marks a node running while backfilling", () => {
    expect(
      outlineNodeRunning({ running: true, backfilling: true, isLast: true })
    ).toBe(false);
  });

  it("does not mark non-last nodes running", () => {
    expect(
      outlineNodeRunning({ running: true, backfilling: false, isLast: false })
    ).toBe(false);
  });
});

// Error events survive the outline's filters as one row each (info events
// are dropped), so three of them give the list rows to anchor on.
const node = (id: string): EventNode =>
  new EventNode(
    id,
    testErrorEvent({ uuid: id, timestamp: "2026-01-01T00:00:00Z" }),
    0
  );

describe("TranscriptOutline persistence scoping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no scrollTo; the virtualizer restores offsets through it.
    Element.prototype.scrollTo = function (this: Element, options?: unknown) {
      if (
        typeof options === "object" &&
        options !== null &&
        "top" in options &&
        typeof options.top === "number"
      ) {
        this.scrollTop = options.top;
      }
    };
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const mountOutline = (
    hooks: ComponentStateHooks,
    listId: string,
    scrollEl: HTMLDivElement
  ) =>
    render(
      <ComponentStateProvider hooks={hooks}>
        <TranscriptOutline
          eventNodes={[node("a"), node("b"), node("c")]}
          defaultCollapsedIds={{}}
          outlineScrollEl={scrollEl}
          listId={listId}
        />
      </ComponentStateProvider>
    );

  it("does not restore one transcript's scroll offset into another", () => {
    // Hosts that never clear the property bag (scout has no equivalent of
    // inspect's SampleLoadController) rely on the persistence key itself
    // being scoped per transcript.
    const hooks = makeReactiveStateHooks();

    // Transcript A: user scrolls the outline's sticky container; the
    // debounced persist records the offset.
    const scrollElA = document.createElement("div");
    document.body.appendChild(scrollElA);
    const viewA = mountOutline(hooks, "transcript-A", scrollElA);
    vi.advanceTimersByTime(50); // initial-scroll settles
    scrollElA.scrollTop = 500;
    scrollElA.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(400); // rAF-throttled capture + persist debounce
    viewA.unmount();
    scrollElA.remove();

    // Transcript B mounts with a fresh container: it must start untouched,
    // not at transcript A's offset.
    const scrollElB = document.createElement("div");
    document.body.appendChild(scrollElB);
    const viewB = mountOutline(hooks, "transcript-B", scrollElB);
    vi.advanceTimersByTime(100);
    expect(scrollElB.scrollTop).toBe(0);
    viewB.unmount();
    scrollElB.remove();
  });

  it("restores the offset when the same transcript remounts", () => {
    const hooks = makeReactiveStateHooks();

    const scrollElA = document.createElement("div");
    document.body.appendChild(scrollElA);
    const viewA = mountOutline(hooks, "transcript-A", scrollElA);
    vi.advanceTimersByTime(50);
    // Outline rows are estimate-sized at 50px: 60 is 10px into row "b".
    scrollElA.scrollTop = 60;
    scrollElA.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(400);
    viewA.unmount();
    scrollElA.remove();

    const scrollElAgain = document.createElement("div");
    // jsdom reports scrollHeight 0, which the virtualizer clamps targets to.
    Object.defineProperty(scrollElAgain, "scrollHeight", { value: 200 });
    document.body.appendChild(scrollElAgain);
    const viewAgain = mountOutline(hooks, "transcript-A", scrollElAgain);
    vi.advanceTimersByTime(100);
    // Restored as the anchor row's start plus the 10px within it.
    expect(scrollElAgain.scrollTop).toBe(60);
    viewAgain.unmount();
    scrollElAgain.remove();
  });
});
