// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";
import {
  ComponentStateProvider,
  type ComponentStateHooks,
} from "@tsmono/react/state";

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

// A reactive component-state store backed by a Map the test can inspect, so
// VirtualList's persisted snapshots survive across mounts like production.
const makeReactiveStateHooks = () => {
  const store = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  let version = 0;
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };
  const emit = () => {
    version++;
    listeners.forEach((l) => l());
  };
  const getKey = (id: string, prop: string) => `${id}::${prop}`;
  const hooks: ComponentStateHooks = {
    useValue: (id: string, prop: string, defaultValue?: unknown) => {
      useSyncExternalStore(subscribe, () => version);
      return store.has(getKey(id, prop))
        ? store.get(getKey(id, prop))
        : defaultValue;
    },
    useSetValue: () => (id: string, prop: string, value: unknown) => {
      if (
        !store.has(getKey(id, prop)) ||
        store.get(getKey(id, prop)) !== value
      ) {
        store.set(getKey(id, prop), value);
        emit();
      }
    },
    useRemoveValue: () => (id: string, prop: string) => {
      if (store.delete(getKey(id, prop))) emit();
    },
    useEntries: () => undefined,
    useRemoveAll: () => () => {},
    useRemoveByPrefix: () => () => {},
  };
  return { hooks, store };
};

const node = (id: string): EventNode =>
  new EventNode(
    id,
    {
      event: "info",
      uuid: id,
      timestamp: "2026-01-01T00:00:00Z",
      source: "",
      data: "",
      pending: false,
      working_start: 0,
      span_id: null,
      metadata: null,
    } as unknown as Event,
    0
  );

describe("TranscriptOutline persistence scoping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollTo = function () {};
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
    const { hooks } = makeReactiveStateHooks();

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
    const { hooks } = makeReactiveStateHooks();

    const scrollElA = document.createElement("div");
    document.body.appendChild(scrollElA);
    const viewA = mountOutline(hooks, "transcript-A", scrollElA);
    vi.advanceTimersByTime(50);
    scrollElA.scrollTop = 500;
    scrollElA.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(400);
    viewA.unmount();
    scrollElA.remove();

    const scrollElAgain = document.createElement("div");
    document.body.appendChild(scrollElAgain);
    const viewAgain = mountOutline(hooks, "transcript-A", scrollElAgain);
    vi.advanceTimersByTime(100);
    expect(scrollElAgain.scrollTop).toBe(500);
    viewAgain.unmount();
    scrollElAgain.remove();
  });
});
