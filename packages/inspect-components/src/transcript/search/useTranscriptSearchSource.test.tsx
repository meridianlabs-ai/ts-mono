// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelEvent } from "@tsmono/inspect-common/types";
import {
  ExtendedFindProvider,
  FindTargetProvider,
  useExtendedFind,
  type FindDirection,
} from "@tsmono/react/components";

import { TimelineEvent, TimelineSpan } from "../timeline/core";
import type { SwimlaneRow } from "../timeline/swimlaneRows";
import type { TranscriptViewNodesHandle } from "../TranscriptViewNodes";
import type { EventNode } from "../types";

import { useTranscriptSearchSource } from "./useTranscriptSearchSource";

// =============================================================================
// Fixtures
// =============================================================================

const ev = (uuid: string, output: string): ModelEvent =>
  ({
    event: "model",
    uuid,
    span_id: null,
    timestamp: "2026-04-29T00:00:00Z",
    working_start: 0,
    pending: false,
    model: "test/model",
    role: null,
    input: [],
    tools: [],
    tool_choice: "auto",
    config: {},
    output: {
      model: "test/model",
      completion: "",
      choices: [
        {
          message: { role: "assistant", content: output, source: "generate" },
          stop_reason: "stop",
        },
      ],
      usage: null,
    },
    error: null,
    cache: null,
    call: null,
    completed: null,
    working_time: null,
    style: null,
    metadata: null,
  }) as unknown as ModelEvent;

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
// Test harness — mounts the hook and exposes the registered functions.
// =============================================================================

interface HarnessOptions {
  events: ModelEvent[];
  rows: SwimlaneRow[];
  selected: string;
  flattenedNodeIds?: string[];
  visibleRange?: { startIndex: number; endIndex: number };
  panels?: { id: string; text: string }[];
  onSelect?: (key: string | null) => void;
  scrollToEvent?: (id: string) => void;
}

interface Harness {
  countAll(term: string): number;
  search(term: string, direction: FindDirection): Promise<boolean>;
  ordinalAt(term: string): number | null;
}

/**
 * Render placeholder panels for the given event ids so `waitForEventInDOM`
 * (which polls `document.getElementById`) can complete. Panels listed here
 * are "reachable"; events whose id is omitted simulate the
 * filtered-out-of-the-rendered-tree case (e.g. nested under a collapsed
 * subtask span) — the hook's skip-the-whole-event logic depends on this
 * distinction.
 */
function renderHarness(opts: HarnessOptions): Harness {
  const flattened: EventNode[] = (opts.flattenedNodeIds ?? []).map(
    (id) => ({ id }) as EventNode
  );
  const harness: Partial<Harness> = {};
  const Probe = () => {
    const { extendedFindTerm, countAllMatches, ordinalAtSelection } =
      useExtendedFind();
    harness.countAll = countAllMatches;
    harness.search = extendedFindTerm;
    harness.ordinalAt = ordinalAtSelection;
    const viewNodesRef = useRef<TranscriptViewNodesHandle | null>({
      scrollToEvent: opts.scrollToEvent ?? vi.fn(),
      getFlattenedNodes: () => flattened,
      getVisibleRange: () =>
        opts.visibleRange ?? { startIndex: 0, endIndex: 0 },
    });
    useTranscriptSearchSource({
      events: opts.events,
      rows: opts.rows,
      selected: opts.selected,
      onSelect: opts.onSelect ?? vi.fn(),
      viewNodesRef,
    });
    return null;
  };
  render(
    <ExtendedFindProvider>
      <FindTargetProvider>
        <Probe />
        {opts.panels?.map((p) => (
          <div key={p.id} id={p.id}>
            {p.text}
          </div>
        ))}
      </FindTargetProvider>
    </ExtendedFindProvider>
  );
  if (!harness.countAll || !harness.search || !harness.ordinalAt)
    throw new Error("harness not ready");
  return harness as Harness;
}

/** Select the first occurrence of `term` inside the panel with id `panelId`. */
function selectTermIn(panelId: string, term: string): void {
  const panel = document.getElementById(panelId);
  if (!panel) throw new Error(`no panel ${panelId}`);
  const textNode = panel.firstChild as Text | null;
  if (!textNode) throw new Error(`panel ${panelId} has no text`);
  const idx = textNode.data.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) throw new Error(`"${term}" not in panel ${panelId}`);
  const range = document.createRange();
  range.setStart(textNode, idx);
  range.setEnd(textNode, idx + term.length);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// =============================================================================
// Tests
// =============================================================================

describe("useTranscriptSearchSource", () => {
  afterEach(() => {
    // Unmount first: a successful searchFn schedules the 300ms
    // reselectTermInPanel self-correction, and only the hook's unmount effect
    // clears it. Left mounted, that timer fires after vitest has torn the
    // jsdom environment down and throws "document is not defined" as an
    // unhandled error, failing the run even though every test passed.
    cleanup();
    // Tests that select text in a stray node appended directly to
    // document.body (outside the React tree, so testing-library's automatic
    // cleanup never removes it) must also clear the document selection —
    // otherwise it would persist into later tests. Removing the strays here
    // (rather than at the end of each test) means a failing assertion still
    // cleans up instead of leaking the node into later tests.
    window.getSelection()?.removeAllRanges();
    document.querySelectorAll("[data-stray-node]").forEach((n) => n.remove());
  });

  it("counts matches across all rows", () => {
    const { events, rows } = twoRowFixture();
    const h = renderHarness({ events, rows, selected: "main" });
    expect(h.countAll("wondering")).toBe(1);
    expect(h.countAll("hello")).toBe(1);
    expect(h.countAll("absent")).toBe(0);
  });

  it("returns false from search when the term has no matches", async () => {
    const { events, rows } = twoRowFixture();
    const onSelect = vi.fn();
    const h = renderHarness({ events, rows, selected: "main", onSelect });
    let result: boolean | null = null;
    await act(async () => {
      result = await h.search("absent", "forward");
    });
    expect(result).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("caches matches across repeated counter calls and invalidates on events change", () => {
    let currentEvents: ModelEvent[] = [ev("e1", "wondering")];
    const harness: Partial<Harness> = {};
    const Probe = () => {
      const { countAllMatches } = useExtendedFind();
      harness.countAll = countAllMatches;
      const viewNodesRef = useRef<TranscriptViewNodesHandle | null>(null);
      const { rows } = singleRowFixture(currentEvents);
      useTranscriptSearchSource({
        events: currentEvents,
        rows,
        selected: "main",
        onSelect: vi.fn(),
        viewNodesRef,
      });
      return null;
    };
    const tree = () => (
      <ExtendedFindProvider>
        <FindTargetProvider>
          <Probe />
        </FindTargetProvider>
      </ExtendedFindProvider>
    );
    const { rerender } = render(tree());
    expect(harness.countAll!("wondering")).toBe(1);
    expect(harness.countAll!("wondering")).toBe(1); // hits the cache

    currentEvents = [ev("e1", "wondering"), ev("e2", "wondering more")];
    rerender(tree());
    expect(harness.countAll!("wondering")).toBe(2); // cache invalidated
  });

  // The headline integration test. The skip-the-whole-event branch of
  // searchFn (matches sharing an unreachable eventId are advanced past in
  // one shot) is the most fragile invariant in the production code: a regression
  // here makes find silently get stuck at the boundary between reachable and
  // unreachable matches. The viewport anchors on e2 itself (the unmounted
  // event), so the very first candidate the viewport anchor hands back is
  // the unreachable one — exercising the skip branch directly, rather than
  // via an incidental next-hop from some other resolved position. By
  // omitting `e2`'s panel from the rendered DOM, we simulate the
  // deeply-nested-under-collapsed-subtask case that motivated the skip
  // logic, and assert that one Next press lands on `e3`.
  it("skips a reachable-but-unmounted event in a single press", async () => {
    const e1 = ev("e1", "wondering one");
    const e2 = ev("e2", "wondering two");
    const e3 = ev("e3", "wondering three");
    const { events, rows } = singleRowFixture([e1, e2, e3]);
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3"],
      visibleRange: { startIndex: 1, endIndex: 1 }, // e2 on screen
      panels: [
        { id: "e1", text: "wondering one" },
        // e2 intentionally omitted — its panel never mounts
        { id: "e3", text: "wondering three" },
      ],
      scrollToEvent,
    });

    let result: boolean | null = null;
    await act(async () => {
      result = await h.search("wondering", "forward");
    });
    expect(result).toBe(true);
    // Both e2 (skipped) and e3 (landed) are scrolled to; the production
    // code calls scrollToEvent for each attempt. The contract that matters
    // is the LAST scroll target.
    const lastScroll = scrollToEvent.mock.calls.at(-1) as [string] | undefined;
    expect(lastScroll?.[0]).toBe("e3");
  });

  it("reports the ordinal of the selected match", () => {
    const { events, rows } = singleRowFixture([
      ev("e1", "wondering one"),
      ev("e2", "wondering two"),
      ev("e3", "wondering three"),
    ]);
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3"],
      panels: [
        { id: "e1", text: "wondering one" },
        { id: "e2", text: "wondering two" },
        { id: "e3", text: "wondering three" },
      ],
    });

    selectTermIn("e2", "wondering");

    expect(h.ordinalAt("wondering")).toBe(1);
  });

  it("indexes a quoted term under the same variants the match list counted", () => {
    // findAllMatches counts BOTH `"role"` and the unquoted `role`, so an
    // ordinal derived from counting only the literal quoted form maps the
    // selection onto an earlier, unrelated match. Here the event holds a bare
    // `role` before the quoted one, so the quoted occurrence is match 1.
    const { events, rows } = singleRowFixture([ev("e1", 'role and "role"')]);
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1"],
      panels: [{ id: "e1", text: 'role and "role"' }],
    });
    expect(h.countAll('"role"')).toBe(2);

    // Select the quoted occurrence, which starts at index 9.
    const textNode = document.getElementById("e1")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 9);
    range.setEnd(textNode, 15);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    expect(h.ordinalAt('"role"')).toBe(1);
  });

  it("reports no ordinal for a selection outside any event panel", () => {
    const { events, rows } = singleRowFixture([ev("e1", "wondering one")]);
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1"],
      panels: [{ id: "e1", text: "wondering one" }],
    });
    const stray = document.createElement("div");
    stray.setAttribute("data-stray-node", "");
    stray.textContent = "wondering elsewhere";
    document.body.appendChild(stray);

    const range = document.createRange();
    range.setStart(stray.firstChild!, 0);
    range.setEnd(stray.firstChild!, "wondering".length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    expect(h.ordinalAt("wondering")).toBeNull();
  });

  // Five events, one match each. The viewport shows only e3, and nothing has
  // been resolved yet — the old code returned -1 here and pickNext sent the
  // user to matches[0], i.e. the top of the transcript.
  const fiveEventFixture = () =>
    singleRowFixture([
      ev("e1", "wondering one"),
      ev("e2", "wondering two"),
      ev("e3", "wondering three"),
      ev("e4", "wondering four"),
      ev("e5", "wondering five"),
    ]);

  const allPanels = ["e1", "e2", "e3", "e4", "e5"].map((id) => ({
    id,
    text: `wondering ${id}`,
  }));

  it("anchors a forward search on the viewport instead of jumping to the top", async () => {
    const { events, rows } = fiveEventFixture();
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3", "e4", "e5"],
      visibleRange: { startIndex: 2, endIndex: 2 }, // e3 on screen
      panels: allPanels,
      scrollToEvent,
    });

    await act(async () => {
      await h.search("wondering", "forward");
    });

    // First match at or after the top of the viewport is e3 itself.
    expect(scrollToEvent.mock.calls.at(-1)?.[0]).toBe("e3");
  });

  // Pins the boundary case the other anchor tests don't reach: the viewport's
  // leading match is matches[0] itself, so the "index just before the
  // viewport" arithmetic bottoms out at -1 — pickNext's own sentinel for
  // "nothing resolved". A clamp that pushes that -1 up to 0 (an earlier,
  // reverted attempt at a fix) would land one match late, on e2.
  it("lands on the first match when the viewport is at the top", async () => {
    const { events, rows } = fiveEventFixture();
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3", "e4", "e5"],
      visibleRange: { startIndex: 0, endIndex: 0 }, // e1 on screen
      panels: allPanels,
      scrollToEvent,
    });

    await act(async () => {
      await h.search("wondering", "forward");
    });

    expect(scrollToEvent.mock.calls.at(-1)?.[0]).toBe("e1");
  });

  it("anchors a backward search on the viewport instead of jumping to the end", async () => {
    const { events, rows } = fiveEventFixture();
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3", "e4", "e5"],
      visibleRange: { startIndex: 2, endIndex: 2 }, // e3 on screen
      panels: allPanels,
      scrollToEvent,
    });

    await act(async () => {
      await h.search("wondering", "backward");
    });

    // Last match at or before the bottom of the viewport is e3 itself.
    expect(scrollToEvent.mock.calls.at(-1)?.[0]).toBe("e3");
  });

  // Pins viewportPosition's "every match sits above the viewport" branch
  // (`first === -1 → matches.length - 1`), which is what makes pickNext wrap
  // forward to matches[0] instead of reproducing the C3 teleport (landing
  // past the end of the array). `e6` has no "wondering" occurrence, so it
  // contributes an event order beyond every match's, putting the viewport
  // past all of them.
  it("wraps a forward search to the top when the viewport sits past every match", async () => {
    const { events: fiveEvents } = fiveEventFixture();
    const e6 = ev("e6", "nothing relevant here");
    const { events, rows } = singleRowFixture([...fiveEvents, e6]);
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3", "e4", "e5", "e6"],
      visibleRange: { startIndex: 5, endIndex: 5 }, // e6 on screen
      panels: [...allPanels, { id: "e6", text: "nothing relevant here" }],
      scrollToEvent,
    });

    await act(async () => {
      await h.search("wondering", "forward");
    });

    // No match sits at or after e6, so viewportPosition anchors at the last
    // match (e5) and pickNext's forward wraparound lands on the first (e1).
    expect(scrollToEvent.mock.calls.at(-1)?.[0]).toBe("e1");
  });

  it("resumes from the last selected match", async () => {
    const { events, rows } = fiveEventFixture();
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3", "e4", "e5"],
      visibleRange: { startIndex: 0, endIndex: 0 },
      panels: allPanels,
      scrollToEvent,
    });
    h.countAll("wondering"); // arms the listener's active term
    selectTermIn("e4", "wondering");
    // Let the selectionchange listener run before searching.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await h.search("wondering", "forward");
    });

    expect(scrollToEvent.mock.calls.at(-1)?.[0]).toBe("e5");
  });

  it("drops a remembered position the selection has moved away from", async () => {
    const { events, rows } = fiveEventFixture();
    const scrollToEvent = vi.fn();
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3", "e4", "e5"],
      visibleRange: { startIndex: 1, endIndex: 1 }, // e2 on screen
      panels: allPanels,
      scrollToEvent,
    });
    h.countAll("wondering");
    // Remember e4...
    selectTermIn("e4", "wondering");
    // Let the selectionchange listener run before searching.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // ...then land on text that maps to no match (the stale-ref teleport).
    const stray = document.createElement("div");
    stray.setAttribute("data-stray-node", "");
    stray.textContent = "wondering elsewhere";
    document.body.appendChild(stray);
    const range = document.createRange();
    range.setStart(stray.firstChild!, 0);
    range.setEnd(stray.firstChild!, "wondering".length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Let the selectionchange listener run before searching.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await h.search("wondering", "forward");
    });

    // Falls back to the viewport (e2), not to the abandoned e4 → e5.
    expect(scrollToEvent.mock.calls.at(-1)?.[0]).toBe("e2");
  });

  // extractEventFields (which findAllMatches counts occurrences from) skips
  // some content a panel actually renders — e.g. assistant `input` messages
  // the model event view still shows. So a panel can hold more DOM
  // occurrences of the term than the event has matches for, and selecting
  // one of those extra occurrences makes matchAtSelection's occurrence-index
  // walk run past the known matches and return null, even though the
  // selection never left the remembered event. Without the fix, that null
  // wipes lastResolvedRef and the next press falls back to the viewport
  // (e1), stalling on the same match instead of advancing.
  it("keeps a remembered position when the selection stays on that event but the index overshoots", async () => {
    const { events, rows } = fiveEventFixture();
    const scrollToEvent = vi.fn();
    // e4's panel renders a second "wondering" beyond the one match
    // findAllMatches counted for e4 — the overshoot case.
    const panels = allPanels.map((p) =>
      p.id === "e4" ? { id: p.id, text: "wondering wondering" } : p
    );
    const h = renderHarness({
      events,
      rows,
      selected: "main",
      flattenedNodeIds: ["e1", "e2", "e3", "e4", "e5"],
      visibleRange: { startIndex: 0, endIndex: 0 }, // e1 on screen
      panels,
      scrollToEvent,
    });
    h.countAll("wondering");
    // Remember e4 via its one real match...
    selectTermIn("e4", "wondering");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // ...then select the second, unindexed "wondering" in the SAME panel:
    // matchAtSelection overshoots and returns null, but the selection is
    // still inside e4.
    const panel = document.getElementById("e4")!;
    const textNode = panel.firstChild as Text;
    const secondIdx = textNode.data.toLowerCase().lastIndexOf("wondering");
    const range = document.createRange();
    range.setStart(textNode, secondIdx);
    range.setEnd(textNode, secondIdx + "wondering".length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await h.search("wondering", "forward");
    });

    // Resumes from the remembered e4 and advances to e5. If the overshoot
    // had wiped the ref, this would fall back to the viewport and land on
    // e1 instead.
    expect(scrollToEvent.mock.calls.at(-1)?.[0]).toBe("e5");
  });
});
