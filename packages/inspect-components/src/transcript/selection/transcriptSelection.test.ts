import { describe, expect, it } from "vitest";

import {
  testInfoEvent,
  testModelEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
} from "@tsmono/inspect-common/testing";

import { eventFallbackIds } from "../transform/treeify";
import { EventNode, type EventType } from "../types";

import {
  buildSelectableEventIndex,
  isSelectableEvent,
  kEmptyTranscriptSelection,
  resolveSelectedEvents,
  resolveSelectedIds,
  selectedEventNodes,
  toggleTranscriptSelection,
} from "./transcriptSelection";

const order = ["a", "b", "c", "d", "e"];
const toggle = (
  state = kEmptyTranscriptSelection,
  id: string,
  extend = false,
  visible = order
) => toggleTranscriptSelection(state, visible, id, extend);

describe("toggleTranscriptSelection", () => {
  it("toggles a single id and records it as the anchor", () => {
    const on = toggle(undefined, "b");
    expect([...on.selectedIds]).toEqual(["b"]);
    expect(on.lastToggledId).toBe("b");
    const off = toggle(on, "b");
    expect(off.selectedIds.size).toBe(0);
  });

  it("shift-click selects the contiguous range from the anchor, in either direction", () => {
    const range = toggle(toggle(undefined, "d"), "b", true);
    expect([...range.selectedIds].sort()).toEqual(["b", "c", "d"]);
    expect(range.lastToggledId).toBe("b");
  });

  it("shift-click on a selected row clears the whole range", () => {
    let state = toggle(undefined, "a");
    state = toggle(state, "d", true);
    expect(state.selectedIds.size).toBe(4);
    state = toggle(state, "a", true);
    expect(state.selectedIds.size).toBe(0);
  });

  it("ranges run over the visible rows only and keep hidden selections", () => {
    const visible = ["a", "b", "d", "e"];
    let state = toggle(undefined, "c");
    state = toggle(state, "a", false, visible);
    state = toggle(state, "d", true, visible);
    expect([...state.selectedIds].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to a single toggle when the anchor is not in the visible order", () => {
    const anchored = { selectedIds: new Set(["gone"]), lastToggledId: "gone" };
    const next = toggle(anchored, "c", true);
    expect([...next.selectedIds].sort()).toEqual(["c", "gone"]);
  });

  it("does not mutate the previous state", () => {
    const prev = { selectedIds: new Set(["a"]), lastToggledId: "a" };
    toggle(prev, "b");
    expect([...prev.selectedIds]).toEqual(["a"]);
  });
});

describe("isSelectableEvent", () => {
  it("excludes span and step structure but keeps real events", () => {
    expect(isSelectableEvent(testSpanBeginEvent())).toBe(false);
    expect(isSelectableEvent(testSpanEndEvent())).toBe(false);
    expect(isSelectableEvent(testModelEvent())).toBe(true);
    expect(isSelectableEvent(testInfoEvent())).toBe(true);
  });
});

describe("selectedEventNodes", () => {
  const nodes = [
    ...order.map((id) => new EventNode(id, testInfoEvent(), 0)),
    new EventNode("span", testSpanBeginEvent(), 0),
  ];
  it("returns the selected nodes in transcript order, ignoring unknown ids", () => {
    const out = selectedEventNodes(nodes, new Set(["c", "a", "zzz"]));
    expect(out.map((n) => n.id)).toEqual(["a", "c"]);
  });
  it("never resolves structural nodes, even by id", () => {
    expect(selectedEventNodes(nodes, new Set(["span", "b"]))).toHaveLength(1);
  });
});

describe("resolveSelectedEvents", () => {
  const ts = (s: number) => `2026-01-01T00:00:${String(s).padStart(2, "0")}Z`;
  const spanBegin = testSpanBeginEvent({
    uuid: "s",
    id: "span-1",
    timestamp: ts(0),
  });
  const model1 = testModelEvent({
    uuid: "m1",
    span_id: "span-1",
    timestamp: ts(1),
  });
  const info = testInfoEvent({
    uuid: null,
    span_id: "span-1",
    timestamp: ts(2),
  });
  const model2 = testModelEvent({
    uuid: null,
    span_id: "span-1",
    timestamp: ts(3),
  });
  const spanEnd = testSpanEndEvent({
    uuid: "e",
    id: "span-1",
    timestamp: ts(4),
  });
  const events: EventType[] = [spanBegin, model1, info, model2, spanEnd];
  const index = buildSelectableEventIndex(events, false);

  it("indexes only selectable events, by uuid or position-based id", () => {
    expect([...index.keys()]).toEqual(["m1", "event_index_2", "event_index_3"]);
  });

  it("resolves events and ids in transcript order", () => {
    const ids = new Set(["event_index_3", "m1", "s", "nope"]);
    const resolved = resolveSelectedEvents(index, ids);
    expect(resolved[0]).toBe(model1);
    expect(resolved[1]).toBe(model2);
    expect(resolveSelectedIds(index, ids)).toEqual(["m1", "event_index_3"]);
  });

  it("gives a pipeline clone of a uuid-less event the same id", () => {
    // Lane suffix stripping clones events with a new span_id; the clone must
    // still take the original's position-based id, or a row checked in a lane
    // view could not be resolved from the full list.
    const clone: EventType = { ...model2, span_id: "" };
    const cloned = buildSelectableEventIndex(
      [spanBegin, model1, info, clone, spanEnd],
      false
    );
    expect(cloned.get("event_index_3")).toBe(clone);
  });

  it("returns nothing for an empty selection", () => {
    expect(resolveSelectedEvents(index, new Set())).toEqual([]);
  });
});

describe("eventFallbackIds", () => {
  const ts = "2026-01-01T00:00:00Z";
  it("matches a clone of a real event by (type, timestamp) but never a span", () => {
    const info = testInfoEvent({ uuid: null, timestamp: ts });
    const span = testSpanBeginEvent({ uuid: null, id: "s", timestamp: ts });
    const ids = eventFallbackIds([span, info]);
    expect(ids.get({ ...info, span_id: "" })).toBe("event_index_1");
    // A synthesized span copies a neighbour's timestamp; it must not inherit
    // the real span's id or two rows would share one.
    expect(ids.get({ ...span, id: "synthetic" })).toBeUndefined();
    expect(ids.get(span)).toBe("event_index_0");
  });

  it("declines an ambiguous signature", () => {
    const a = testInfoEvent({ uuid: null, timestamp: ts });
    const b = testInfoEvent({ uuid: null, timestamp: ts });
    expect(eventFallbackIds([a, b]).get({ ...a })).toBeUndefined();
  });
});
