// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useCallback, useState, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";
import {
  ComponentStateProvider,
  type ComponentStateHooks,
} from "@tsmono/react/state";

import { useTimelinePipeline } from "./useTimelinePipeline";

// =============================================================================
// Reactive in-memory ComponentStateProvider for testing
// =============================================================================

function InMemoryStateWrapper({ children }: PropsWithChildren) {
  const [store, setStore] = useState(
    () => new Map<string, Map<string, unknown>>()
  );

  const getPropertyBag = useCallback(
    (id: string): Map<string, unknown> => {
      let bag = store.get(id);
      if (!bag) {
        bag = new Map();
        store.set(id, bag);
      }
      return bag;
    },
    [store]
  );

  const hooks: ComponentStateHooks = {
    useValue: (id: string, prop: string, defaultValue?: unknown): unknown => {
      const bag = getPropertyBag(id);
      return bag.has(prop) ? bag.get(prop) : defaultValue;
    },
    useSetValue: () => (id: string, prop: string, value: unknown) => {
      getPropertyBag(id).set(prop, value);
      setStore((prev) => new Map(prev));
    },
    useRemoveValue: () => (id: string, prop: string) => {
      getPropertyBag(id).delete(prop);
      setStore((prev) => new Map(prev));
    },
    useEntries: (id: string): Record<string, unknown> | undefined => {
      const bag = store.get(id);
      if (!bag) return undefined;
      return Object.fromEntries(bag);
    },
    useRemoveAll: () => (id: string) => {
      store.delete(id);
      setStore((prev) => new Map(prev));
    },
    useRemoveByPrefix: () => (id: string, prefix: string) => {
      const bag = store.get(id);
      if (!bag) return;
      for (const key of [...bag.keys()]) {
        if (key.startsWith(prefix)) bag.delete(key);
      }
      setStore((prev) => new Map(prev));
    },
  };

  return (
    <ComponentStateProvider hooks={hooks}>{children}</ComponentStateProvider>
  );
}

// =============================================================================
// Fixtures
// =============================================================================

function makeModelEvent(uuid: string, startSec: number): Event {
  return {
    event: "model",
    uuid,
    model: "test-model",
    input: [],
    output: {
      choices: [
        {
          message: { role: "assistant", content: "response" },
          stop_reason: "stop",
        },
      ],
      completion: "response",
      model: "test-model",
    },
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: new Date(1705312800000 + startSec * 1000).toISOString(),
    working_start: startSec,
    working_time: 1,
    error: null,
    pending: false,
    span_id: null,
  } as unknown as Event;
}

function makeInfoEvent(uuid: string, startSec: number): Event {
  return {
    event: "info",
    uuid,
    source: "test",
    data: "",
    timestamp: new Date(1705312800000 + startSec * 1000).toISOString(),
    working_start: startSec,
    pending: false,
    span_id: null,
  } as unknown as Event;
}

// =============================================================================
// useTimelinePipeline
// =============================================================================

describe("useTimelinePipeline", () => {
  const flatEvents = [makeModelEvent("e1", 0), makeInfoEvent("e2", 1)];

  it("hides swimlanes for a flat event stream and feeds all events", () => {
    const { result } = renderHook(
      () => useTimelinePipeline({ events: flatEvents }),
      { wrapper: InMemoryStateWrapper }
    );
    expect(result.current.showSwimlanes).toBe(false);
    expect(result.current.swimlanesDefaultCollapsed).toBe(true);
    // No filtering or selection: the feed and search set are the input array.
    expect(result.current.nodeFeed.events).toBe(flatEvents);
    expect(result.current.nodeFeed.sourceSpans).toBeUndefined();
    expect(result.current.searchableEvents).toBe(flatEvents);
  });

  it("honors an explicit showSwimlanes override", () => {
    const { result } = renderHook(
      () => useTimelinePipeline({ events: flatEvents, showSwimlanes: true }),
      { wrapper: InMemoryStateWrapper }
    );
    expect(result.current.showSwimlanes).toBe(true);
    // With swimlanes on the feed carries the (empty) source-span map.
    expect(result.current.nodeFeed.sourceSpans).toBeInstanceOf(Map);
  });

  it("filters hidden event types from the node feed and search set", () => {
    const { result } = renderHook(
      () =>
        useTimelinePipeline({
          events: flatEvents,
          hiddenEventTypes: ["info"],
        }),
      { wrapper: InMemoryStateWrapper }
    );
    expect(result.current.nodeFeed.events.map((e) => e.event)).toEqual([
      "model",
    ]);
    expect(result.current.searchableEvents.map((e) => e.event)).toEqual([
      "model",
    ]);
  });

  it("preserves feed and search identities when inputs are unchanged", () => {
    const hiddenEventTypes = ["info"];
    const { result, rerender } = renderHook(
      () =>
        useTimelinePipeline({
          events: flatEvents,
          hiddenEventTypes,
        }),
      { wrapper: InMemoryStateWrapper }
    );
    const firstNodeFeed = result.current.nodeFeed;
    const firstFeedEvents = result.current.nodeFeed.events;
    const firstSearchableEvents = result.current.searchableEvents;

    rerender();

    expect(result.current.nodeFeed).toBe(firstNodeFeed);
    expect(result.current.nodeFeed.events).toBe(firstFeedEvents);
    expect(result.current.searchableEvents).toBe(firstSearchableEvents);
  });

  it("always returns the full timeline pipeline result", () => {
    const { result } = renderHook(
      () => useTimelinePipeline({ events: flatEvents }),
      { wrapper: InMemoryStateWrapper }
    );
    expect(result.current.timeline.timelines).toHaveLength(1);
    // Identity is not preserved here: the timeline pipeline re-sorts via
    // correctRetryTimestamps, so compare by value.
    expect(result.current.timeline.selectedEvents).toEqual(flatEvents);
    expect(result.current.timelineConfig.markerConfig).toBeDefined();
  });
});
