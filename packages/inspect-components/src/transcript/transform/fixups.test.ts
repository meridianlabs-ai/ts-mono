import { describe, expect, it } from "vitest";

import {
  testSpanEndEvent,
  testStateEvent,
  testStoreEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type {
  Event,
  JsonChange,
  StoreEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { fixupEventStream } from "./fixups";

const toolEvent = (
  id: string,
  uuid: string | null,
  pending: boolean
): ToolEvent =>
  testToolEvent({
    id,
    uuid,
    pending,
    timestamp: "2026-01-01T00:00:00Z",
    function: "noop",
    span_id: null,
  });

const eventIds = (events: Event[]) =>
  events.filter((e): e is ToolEvent => e.event === "tool").map((e) => e.id);

describe("fixupEventStream — pending coalescing", () => {
  it("preserves N parallel pending tool events with distinct uuids", () => {
    // Parallel sibling tool calls: distinct uuids, all pending. Each is a
    // separate logical event — none should be collapsed away.
    const events: Event[] = [
      toolEvent("a", "uuid-a", true),
      toolEvent("b", "uuid-b", true),
      toolEvent("c", "uuid-c", true),
    ];
    const out = fixupEventStream(events, false);
    expect(eventIds(out)).toEqual(["a", "b", "c"]);
  });

  it("coalesces repeated emissions of the same pending event by uuid", () => {
    // Streaming update on a single logical event: same uuid, second
    // emission replaces the first.
    const first = toolEvent("a", "uuid-a", true);
    const second = toolEvent("a", "uuid-a", true);
    const out = fixupEventStream([first, second], false);
    const tools = out.filter((e): e is ToolEvent => e.event === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toBe(second);
  });

  it("does not coalesce pending events with uuid=null", () => {
    // Synthetic events without a uuid can't be matched as "same logical
    // event", so they must never overwrite a neighbor.
    const events: Event[] = [
      toolEvent("a", null, true),
      toolEvent("b", null, true),
    ];
    const out = fixupEventStream(events, false);
    expect(eventIds(out)).toEqual(["a", "b"]);
  });

  it("filters all pending events when filterPending=true", () => {
    const events: Event[] = [
      toolEvent("a", "uuid-a", true),
      toolEvent("b", "uuid-b", false),
      toolEvent("c", "uuid-c", true),
    ];
    const out = fixupEventStream(events, true);
    expect(eventIds(out)).toEqual(["b"]);
  });
});

describe("fixupEventStream — store event echo dedupe", () => {
  const changes: JsonChange[] = [
    { op: "add", path: "/HumanAgentState:logs", value: { "s.output": "x" }, replaced: null },
    { op: "add", path: "/HumanAgentState:answer", value: "INC-1042", replaced: null },
  ];

  const storeEvent = (uuid: string, c: JsonChange[] = changes): StoreEvent =>
    testStoreEvent({ uuid, changes: c });

  const storeUuids = (events: Event[]) =>
    events.filter((e): e is StoreEvent => e.event === "store").map((e) => e.uuid);

  it("keeps only the last of identical store events separated by span closes", () => {
    // inspect_ai emits a store diff at every enclosing span end, so a write
    // inside nested spans is re-reported once per level (identical changes,
    // separated only by span_end/state events). Keep the outermost report.
    const events: Event[] = [
      storeEvent("inner"),
      testSpanEndEvent({ id: "agent" }),
      testStateEvent(),
      storeEvent("middle"),
      testSpanEndEvent({ id: "solver" }),
      storeEvent("outer"),
      testSpanEndEvent({ id: "solvers" }),
    ];
    expect(storeUuids(fixupEventStream(events))).toEqual(["outer"]);
  });

  it("keeps identical store events separated by substantive activity", () => {
    // Same diff twice with real work in between is two genuine reports
    // (e.g. a value toggled away and back across two spans), not an echo.
    const events: Event[] = [
      storeEvent("first"),
      toolEvent("t", "uuid-t", false),
      storeEvent("second"),
    ];
    expect(storeUuids(fixupEventStream(events))).toEqual(["first", "second"]);
  });

  it("keeps adjacent store events with different changes", () => {
    const other: JsonChange[] = [
      { op: "replace", path: "/Other:key", value: 1, replaced: null },
    ];
    const events: Event[] = [
      storeEvent("first"),
      testSpanEndEvent({ id: "inner" }),
      storeEvent("second", other),
    ];
    expect(storeUuids(fixupEventStream(events))).toEqual(["first", "second"]);
  });

  it("leaves a lone store event untouched", () => {
    const events: Event[] = [storeEvent("only")];
    expect(storeUuids(fixupEventStream(events))).toEqual(["only"]);
  });
});
