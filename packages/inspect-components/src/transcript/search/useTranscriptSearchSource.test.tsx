// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testInfoEvent,
  testModelEvent,
  testModelOutput,
} from "@tsmono/inspect-common/testing";
import type { ModelEvent } from "@tsmono/inspect-common/types";
import {
  ExtendedFindProvider,
  useExtendedFind,
  type FindSource,
} from "@tsmono/react/components";

import { TimelineEvent, TimelineSpan } from "../timeline/core";
import type { SwimlaneRow } from "../timeline/swimlaneRows";
import type { TranscriptViewNodesHandle } from "../TranscriptViewNodes";
import { EventNode } from "../types";

import { useTranscriptSearchSource } from "./useTranscriptSearchSource";

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
// Test harness — mounts the hook and exposes the registered source.
// =============================================================================

interface HarnessOptions {
  events: ModelEvent[];
  rows: SwimlaneRow[];
  selected: string;
  flattenedNodeIds?: string[];
  /** Event panels rendered in the transcript's element. */
  panels?: { id: string; text: string }[];
  onSelect?: (key: string | null) => void;
  scrollToEvent?: (id: string) => void;
}

function renderHarness(opts: HarnessOptions) {
  const flattened: EventNode[] = (opts.flattenedNodeIds ?? []).map(
    (id) => new EventNode(id, testInfoEvent({ uuid: id }), 0)
  );
  const harness: { source?: FindSource } = {};
  const Probe = () => {
    const { getFindSources } = useExtendedFind();
    const viewNodesRef = useRef<TranscriptViewNodesHandle | null>({
      scrollToEvent: opts.scrollToEvent ?? vi.fn(),
      getFlattenedNodes: () => flattened,
      getElement: () => document.getElementById("transcript"),
    });
    useTranscriptSearchSource({
      events: opts.events,
      rows: opts.rows,
      selected: opts.selected,
      onSelect: opts.onSelect ?? vi.fn(),
      viewNodesRef,
    });
    harness.source = getFindSources().get("transcript-sample");
    return null;
  };
  const tree = () => (
    <ExtendedFindProvider>
      <Probe />
      <p id="outside">wondering outside</p>
      {/* An element outside the transcript sharing an event's id. */}
      <div id="e2">
        <span>wondering elsewhere</span>
      </div>
      <div id="transcript">
        {opts.panels?.map((p) => (
          <div key={p.id} id={p.id}>
            <span>{p.text}</span>
          </div>
        ))}
      </div>
    </ExtendedFindProvider>
  );
  const { rerender } = render(tree());
  // The hook registers in an effect, after the probe's first render.
  rerender(tree());
  const registered = harness.source;
  if (!registered) throw new Error("source not registered");
  return { source: () => registered };
}

const textIn = (id: string) => document.getElementById(id)!.firstChild!;

// =============================================================================
// Tests
// =============================================================================

afterEach(cleanup);

describe("useTranscriptSearchSource", () => {
  it("counts matches by event, across every row", () => {
    const { events, rows } = twoRowFixture();
    const { source } = renderHarness({ events, rows, selected: "main" });
    expect(source().countByItem("wondering")).toEqual([{ item: 1, count: 1 }]);
    expect(source().countByItem("hello")).toEqual([{ item: 0, count: 1 }]);
    expect(source().countByItem("absent")).toEqual([]);
  });

  it("recounts when the events change", () => {
    let events: ModelEvent[] = [ev("e1", "wondering")];
    const Probe = ({ onSource }: { onSource: (s?: FindSource) => void }) => {
      const { getFindSources } = useExtendedFind();
      const viewNodesRef = useRef<TranscriptViewNodesHandle | null>(null);
      useTranscriptSearchSource({
        events,
        rows: singleRowFixture(events).rows,
        selected: "main",
        onSelect: vi.fn(),
        viewNodesRef,
      });
      onSource(getFindSources().get("transcript-sample"));
      return null;
    };
    let source: FindSource | undefined;
    const tree = () => (
      <ExtendedFindProvider>
        <Probe onSource={(s) => (source = s)} />
      </ExtendedFindProvider>
    );
    const { rerender } = render(tree());
    rerender(tree());
    expect(source?.countByItem("wondering")).toEqual([{ item: 0, count: 1 }]);

    events = [ev("e1", "wondering"), ev("e2", "wondering more")];
    rerender(tree());
    rerender(tree());
    expect(source?.countByItem("wondering")).toEqual([
      { item: 0, count: 1 },
      { item: 1, count: 1 },
    ]);
  });

  it("maps rendered text to its event and lists the rendered events", () => {
    const { events, rows } = twoRowFixture();
    const { source } = renderHarness({
      events,
      rows,
      selected: "main",
      panels: [{ id: "e1", text: "hello" }],
    });
    expect(source().itemOf(textIn("e1").firstChild!)).toBe(0);
    expect(source().itemOf(textIn("outside"))).toBe(null);
    expect(source().itemOf(textIn("e2").firstChild!)).toBe(null);
    expect([...source().renderedItems()]).toEqual([0]);
    expect(source().anchor()?.id).toBe("transcript");
  });

  it("reveals an event in another row by switching to it and scrolling", async () => {
    const { events, rows } = twoRowFixture();
    const onSelect = vi.fn();
    const scrollToEvent = vi.fn();
    const { source } = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e2"],
      panels: [{ id: "e2", text: "wondering" }],
      onSelect,
      scrollToEvent,
    });

    let revealed: boolean | null = null;
    await act(async () => {
      revealed = await source().reveal(
        1,
        "forward",
        new AbortController().signal
      );
    });

    expect(revealed).toBe(true);
    expect(onSelect).toHaveBeenCalledWith("main/sub");
    expect(scrollToEvent).toHaveBeenCalledWith("e2");
  });

  it("reports an event that never renders", async () => {
    const { events, rows } = singleRowFixture([ev("e1", "wondering")]);
    const { source } = renderHarness({ events, rows, selected: "main" });

    let revealed: boolean | null = null;
    await act(async () => {
      revealed = await source().reveal(
        0,
        "forward",
        new AbortController().signal
      );
    });

    expect(revealed).toBe(false);
  });
});
