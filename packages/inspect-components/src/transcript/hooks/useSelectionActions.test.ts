import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimelineSpan } from "../timeline/core";
import type { TimelineState } from "../timeline/hooks";
import type { SwimlaneRow } from "../timeline/swimlaneRows";

import { useSelectionActions } from "./useSelectionActions";

// =============================================================================
// Fixtures
// =============================================================================

/** Minimal single-agent-span swimlane row (the shape buildSpanSelectKeys reads). */
function agentRow(key: string, spanId: string): SwimlaneRow {
  const agent = new TimelineSpan({
    id: spanId,
    name: spanId,
    spanType: "agent",
  });
  return {
    key,
    name: spanId,
    depth: 1,
    branch: false,
    spans: [{ agent }],
    totalTokens: 0,
    startTime: new Date(0),
    endTime: new Date(0),
  };
}

function makeTimelineState(rows: SwimlaneRow[]) {
  const select = vi.fn<TimelineState["select"]>();
  const state: TimelineState = {
    node: new TimelineSpan({ id: "root", name: "root", spanType: "root" }),
    rows,
    selected: null,
    select,
    clearSelection: () => {},
  };
  return { state, select };
}

function makeScrollRef(scrollTop = 0) {
  const el = document.createElement("div");
  el.scrollTop = scrollTop;
  const scrollTo = vi.fn();
  el.scrollTo = scrollTo;
  const ref: RefObject<HTMLDivElement> = { current: el };
  return { ref, scrollTo };
}

// =============================================================================
// useSelectionActions
// =============================================================================

describe("useSelectionActions", () => {
  let rafQueue: FrameRequestCallback[] = [];

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback): number => {
        rafQueue.push(callback);
        return rafQueue.length;
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushFrames = () => {
    const callbacks = rafQueue;
    rafQueue = [];
    for (const callback of callbacks) callback(performance.now());
  };

  it("selects the row rendering a span (agent card clicks)", () => {
    const { state, select } = makeTimelineState([agentRow("root/a", "span-a")]);
    const { ref } = makeScrollRef();
    const { result } = renderHook(() =>
      useSelectionActions({ timelineState: state, scrollRef: ref })
    );

    result.current.selectBySpanId("span-a");
    expect(select).toHaveBeenCalledWith("root/a");

    select.mockClear();
    result.current.selectBySpanId("unknown");
    expect(select).not.toHaveBeenCalled();
  });

  it("selects by row key preserving scroll, without an anchor", () => {
    const { state, select } = makeTimelineState([]);
    const { ref } = makeScrollRef();
    const { result } = renderHook(() =>
      useSelectionActions({ timelineState: state, scrollRef: ref })
    );

    result.current.selectByRowKey("root/b");
    expect(select).toHaveBeenCalledWith("root/b", { preserveScroll: true });
    expect(result.current.hasScrollTarget).toBe(false);
  });

  it("anchors and restores the scroll position once for navigator clicks", () => {
    const { state } = makeTimelineState([]);
    const { ref, scrollTo } = makeScrollRef(123);
    const { result } = renderHook(() =>
      useSelectionActions({ timelineState: state, scrollRef: ref })
    );

    act(() =>
      result.current.selectByRowKey("root/b", document.createElement("div"))
    );
    expect(result.current.hasScrollTarget).toBe(true);

    // The restore runs in rAF after the selection lands.
    act(flushFrames);
    expect(scrollTo).toHaveBeenCalledWith({ top: 123 });
    expect(result.current.hasScrollTarget).toBe(false);

    act(() => result.current.selectByRowKey("root/c"));
    expect(result.current.hasScrollTarget).toBe(false);
  });

  it("reports a pending scroll target for deep links", () => {
    const { state } = makeTimelineState([]);
    const { ref } = makeScrollRef();
    const { result } = renderHook(() =>
      useSelectionActions({
        timelineState: state,
        scrollRef: ref,
        initialMessageId: "m1",
      })
    );
    expect(result.current.hasScrollTarget).toBe(true);
  });
});
