import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useMemo, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
} from "@tsmono/inspect-common/testing";
import type { ModelEvent } from "@tsmono/inspect-common/types";
import { FindTargetProvider } from "@tsmono/react/components";
import {
  FindProvider,
  useFindCoordinator,
  useFindState,
  type FindCoordinator,
  type FindState,
} from "@tsmono/react/find";

import { TimelineEvent, TimelineSpan } from "../timeline/core";
import type { SwimlaneRow } from "../timeline/swimlaneRows";
import type { TranscriptViewNodesHandle } from "../TranscriptViewNodes";
import { EventNode } from "../types";

import { useTranscriptFindSurface } from "./useTranscriptFindSurface";

const noopSelect = () => {};

// =============================================================================
// Fixtures
// =============================================================================

const ev = (uuid: string, output: string): ModelEvent =>
  testModelEvent({
    uuid,
    span_id: null,
    timestamp: "2026-04-29T00:00:00Z",
    pending: false,
    model: "test/model",
    role: null,
    output: testModelOutput({
      model: "test/model",
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({
            content: output,
            source: "generate",
          }),
        }),
      ],
      usage: null,
    }),
    error: null,
    cache: null,
    call: null,
    completed: null,
    working_time: null,
    metadata: null,
  });

function makeRow(key: string, agent: TimelineSpan, depth = 0): SwimlaneRow {
  return {
    key,
    name: agent.name,
    depth,
    spans: [{ agent }],
    totalTokens: 0,
    startTime: new Date(0),
    endTime: new Date(0),
  };
}

function singleRowFixture(events: ModelEvent[]) {
  const main = new TimelineSpan({
    id: "main",
    name: "main",
    spanType: "agent",
    content: events.map((e) => new TimelineEvent(e)),
  });
  return { events, rows: [makeRow("main", main, 0)] as SwimlaneRow[] };
}

function twoRowFixture() {
  // main row contains e1 ("hello"); main/sub row contains e2 ("wondering")
  const e1 = ev("e1", "hello");
  const e2 = ev("e2", "wondering");
  const sub = new TimelineSpan({
    id: "sub",
    name: "sub",
    spanType: "agent",
    content: [new TimelineEvent(e2)],
  });
  const main = new TimelineSpan({
    id: "main",
    name: "main",
    spanType: "agent",
    content: [new TimelineEvent(e1), sub],
  });
  return {
    events: [e1, e2] as ModelEvent[],
    rows: [
      makeRow("main", main, 0),
      makeRow("main/sub", sub, 1),
    ] as SwimlaneRow[],
  };
}

// =============================================================================
// Test harness — mounts the hook inside a FindProvider and exposes the
// coordinator + live state.
// =============================================================================

interface HarnessOptions {
  events: ModelEvent[];
  rows: SwimlaneRow[];
  selected: string;
  flattenedNodeIds?: string[];
  /** Event panels rendered to the DOM (reachable events). Events whose id
   *  is omitted simulate content that never mounts. */
  panels?: { id: string; text: string }[];
  onSelect?: (key: string | null) => void;
  scrollToEvent?: (id: string) => void;
}

interface Harness {
  coordinator: FindCoordinator;
  state: () => FindState;
}

function renderHarness(opts: HarnessOptions): Harness {
  const flattened: EventNode[] = (opts.flattenedNodeIds ?? []).map(
    (id) => new EventNode(id, ev(id, ""), 0)
  );
  const captured: {
    coordinator?: FindCoordinator;
    state?: FindState;
  } = {};
  const onSelect = opts.onSelect ?? vi.fn();
  const Probe = () => {
    const coordinator = useFindCoordinator();
    const state = useFindState();
    useEffect(() => {
      captured.coordinator = coordinator;
    }, [coordinator]);
    captured.state = state;
    const viewNodesRef = useRef<TranscriptViewNodesHandle | null>({
      scrollToEvent: opts.scrollToEvent ?? vi.fn(),
      getFlattenedNodes: () => flattened,
      getVisibleRange: () => ({ startIndex: 0, endIndex: 0 }),
    });
    useTranscriptFindSurface({
      events: opts.events,
      rows: opts.rows,
      selected: opts.selected,
      onSelect,
      viewNodesRef,
    });
    return null;
  };
  render(
    <FindProvider>
      <FindTargetProvider>
        <Probe />
        {opts.panels?.map((p) => (
          <div key={p.id} id={p.id}>
            {p.text}
          </div>
        ))}
      </FindTargetProvider>
    </FindProvider>
  );
  const coordinator = captured.coordinator;
  if (!coordinator) throw new Error("harness not ready");
  return {
    coordinator,
    state: () => {
      if (!captured.state) throw new Error("state not captured");
      return captured.state;
    },
  };
}

const setTerm = (h: Harness, term: string) =>
  act(() => h.coordinator.setTerm(term));

// =============================================================================
// Tests
// =============================================================================

describe("useTranscriptFindSurface", () => {
  it("counts matches across all rows", async () => {
    const { events, rows } = twoRowFixture();
    const h = renderHarness({ events, rows, selected: "main" });

    setTerm(h, "wondering");
    await waitFor(() => expect(h.state().total?.value).toBe(1));

    setTerm(h, "hello");
    await waitFor(() => expect(h.state().total?.value).toBe(1));

    setTerm(h, "absent");
    await waitFor(() => expect(h.state().noResults).toBe(true));
  });

  it("does not navigate when the term has no matches", async () => {
    const { events, rows } = twoRowFixture();
    const onSelect = vi.fn();
    const h = renderHarness({ events, rows, selected: "main", onSelect });

    setTerm(h, "absent");
    await waitFor(() => expect(h.state().noResults).toBe(true));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("switches swimlane row and scrolls to reveal a match in another row", async () => {
    const { events, rows } = twoRowFixture();
    const onSelect = vi.fn();
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      onSelect,
      scrollToEvent,
      flattenedNodeIds: ["e1", "e2"],
      panels: [
        { id: "e1", text: "hello" },
        { id: "e2", text: "wondering" },
      ],
    });

    setTerm(h, "wondering");

    await waitFor(() => expect(scrollToEvent).toHaveBeenCalledWith("e2"));
    expect(onSelect).toHaveBeenCalledWith("main/sub");
    expect(h.state().activeIndex).toBe(0);
  });

  it("reveals without a row switch when the match is on the selected row", async () => {
    const { events, rows } = singleRowFixture([ev("e1", "wondering")]);
    const onSelect = vi.fn();
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      onSelect,
      scrollToEvent,
      flattenedNodeIds: ["e1"],
      panels: [{ id: "e1", text: "wondering" }],
    });

    setTerm(h, "wondering");

    await waitFor(() => expect(scrollToEvent).toHaveBeenCalledWith("e1"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("steps across events with wrap-around", async () => {
    const e1 = ev("e1", "wondering one");
    const e2 = ev("e2", "wondering two");
    const { events, rows } = singleRowFixture([e1, e2]);
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      scrollToEvent,
      flattenedNodeIds: ["e1", "e2"],
      panels: [
        { id: "e1", text: "wondering one" },
        { id: "e2", text: "wondering two" },
      ],
    });

    setTerm(h, "wondering");
    await waitFor(() => expect(scrollToEvent).toHaveBeenCalledWith("e1"));

    act(() => h.coordinator.next());
    await waitFor(() => expect(scrollToEvent).toHaveBeenCalledWith("e2"));
    expect(h.state().activeIndex).toBe(1);

    act(() => h.coordinator.next()); // wrap
    await waitFor(() => expect(h.state().activeIndex).toBe(0));
  });

  it("recounts when the events change (source re-registration)", async () => {
    let currentEvents: ModelEvent[] = [ev("e1", "wondering")];
    const captured: { coordinator?: FindCoordinator; state?: FindState } = {};
    const Probe = () => {
      const coordinator = useFindCoordinator();
      const state = useFindState();
      useEffect(() => {
        captured.coordinator = coordinator;
      }, [coordinator]);
      captured.state = state;
      const viewNodesRef = useRef<TranscriptViewNodesHandle | null>(null);
      const events = currentEvents;
      // Memoized like production callers: an identity-stable rows/events
      // pair per data version (a per-render rebuild would re-register the
      // source every render).
      const rows = useMemo(() => singleRowFixture(events).rows, [events]);
      useTranscriptFindSurface({
        events,
        rows,
        selected: "main",
        onSelect: noopSelect,
        viewNodesRef,
      });
      return null;
    };
    const tree = () => (
      <FindProvider>
        <FindTargetProvider>
          <Probe />
        </FindTargetProvider>
      </FindProvider>
    );
    const { rerender } = render(tree());
    act(() => captured.coordinator?.setTerm("wondering"));
    await waitFor(() => expect(captured.state?.total?.value).toBe(1));

    currentEvents = [ev("e1", "wondering"), ev("e2", "wondering more")];
    rerender(tree());
    await waitFor(() => expect(captured.state?.total?.value).toBe(2));
  });
});
