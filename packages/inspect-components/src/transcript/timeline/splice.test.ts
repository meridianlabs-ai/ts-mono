import { describe, expect, it } from "vitest";

import {
  testAnchorEvent,
  testInfoEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";

import {
  canSplice,
  spliceToTimeline,
  TimelineEvent,
  TimelineSpan,
  type Timeline,
} from "./core";

const kTimestamp = "2025-01-01T00:00:00Z";

function anchor(id: string, spanId?: string): Event {
  return testAnchorEvent({
    anchor_id: id,
    timestamp: kTimestamp,
    span_id: spanId ?? null,
    uuid: `a-${id}`,
  });
}

function info(id: string): Event {
  return testInfoEvent({ timestamp: kTimestamp, uuid: id });
}

function spanBegin(id: string, parentId: string): Event {
  return testSpanBeginEvent({
    id,
    name: id,
    parent_id: parentId,
    timestamp: kTimestamp,
    span_id: id,
    uuid: `sb-${id}`,
  });
}

function spanEnd(id: string): Event {
  return testSpanEndEvent({
    id,
    timestamp: kTimestamp,
    span_id: id,
    uuid: `se-${id}`,
  });
}

function ts(id: string, branchedFrom: string | null, events: Event[]) {
  return new TimelineSpan({
    id,
    name: "trajectory",
    spanType: "branch",
    branchedFrom,
    content: events.map((e) => new TimelineEvent(e)),
  });
}

function agent(
  id: string,
  content: (Event | TimelineSpan)[],
  props: { branches?: TimelineSpan[]; branchedFrom?: string } = {}
) {
  return new TimelineSpan({
    id,
    name: id,
    spanType: "agent",
    content: content.map((c) =>
      c instanceof TimelineSpan ? c : new TimelineEvent(c)
    ),
    ...props,
  });
}

function splice(root: TimelineSpan, target: TimelineSpan): Timeline {
  const timeline = spliceToTimeline(root, target);
  if (!timeline) throw new Error(`could not splice ${target.id}`);
  return timeline;
}

/** Event uuids in document order, descending into child spans. */
function eventIds(span: TimelineSpan): string[] {
  return span.content.flatMap((item) =>
    item.type === "span" ? eventIds(item) : [item.event.uuid ?? ""]
  );
}

/** Span names in document order, excluding the root. */
function spanNames(span: TimelineSpan): string[] {
  return span.content.flatMap((item) =>
    item.type === "span" ? [item.name, ...spanNames(item)] : []
  );
}

describe("spliceToTimeline", () => {
  it("root only returns root content", () => {
    const root = ts("R", null, [anchor("A1")]);
    expect(eventIds(splice(root, root).root)).toEqual(["a-A1"]);
  });

  it("cuts ancestor at matching anchor", () => {
    const b = ts("B", "A1", [anchor("B1")]);
    const root = ts("R", null, [anchor("A1"), anchor("A2")]);
    root.branches = [b];
    expect(eventIds(splice(root, b).root)).toEqual(["a-A1", "a-B1"]);
  });

  it("restart clears ancestor prefix", () => {
    const b = ts("B", "", [anchor("B1")]);
    const root = ts("R", null, [anchor("A1")]);
    root.branches = [b];
    expect(eventIds(splice(root, b).root)).toEqual(["a-B1"]);
  });

  it("strips per-segment trajectory suffix from span ids", () => {
    const b = ts("B", "A", [spanEnd("x#0:B")]);
    const root = ts("R", null, [spanBegin("x#0:R", "R"), anchor("A", "x#0:R")]);
    root.branches = [b];
    const events = splice(root, b).root.content.flatMap((c) =>
      c.type === "event" ? [c.event] : []
    );
    const ids = events.flatMap((e) =>
      e.event === "span_begin" || e.event === "span_end" ? [e.id] : []
    );
    expect(ids).toEqual(["x#0", "x#0"]);
    // parent_id pointing at the trajectory itself is normalized to ""
    const begin = events.find((e) => e.event === "span_begin");
    expect(begin && "parent_id" in begin ? begin.parent_id : null).toBe("");
  });

  it("nested chain concatenates each ancestor's prefix", () => {
    const c = ts("C", "B1", [anchor("C1")]);
    const b = ts("B", "A1", [anchor("B1"), anchor("B2")]);
    b.branches = [c];
    const root = ts("R", null, [anchor("A1")]);
    root.branches = [b];
    expect(eventIds(splice(root, c).root)).toEqual(["a-A1", "a-B1", "a-C1"]);
  });

  it("starts at the agent span that holds a nested branch", () => {
    const branch = agent("B", [info("b1")], { branchedFrom: "F" });
    const lane = agent("L", [info("l1"), anchor("F"), info("l2")], {
      branches: [branch],
    });
    const root = agent("R", [info("r1"), lane, info("r2")]);
    const spliced = splice(root, branch);
    expect(eventIds(spliced.root)).toEqual(["l1", "a-F", "b1"]);
  });

  it("keeps child agent spans whole", () => {
    const before = agent("before", [info("s1")]);
    const inside = agent("inside", [info("s2")]);
    const branch = agent("B", [info("b1"), inside], { branchedFrom: "F" });
    const root = agent("R", [info("r1"), before, anchor("F"), info("r2")], {
      branches: [branch],
    });
    const spliced = splice(root, branch).root;
    expect(eventIds(spliced)).toEqual(["r1", "s1", "a-F", "b1", "s2"]);
    expect(spanNames(spliced)).toEqual(["before", "inside"]);
  });

  it("rebuilds inline agent spans alongside child spans", () => {
    const before = agent("before", [info("s1")]);
    const retryBegin = testSpanBeginEvent({
      id: "retry",
      name: "retry",
      type: "agent",
      parent_id: null,
      timestamp: kTimestamp,
      span_id: "retry",
      uuid: "sb-retry",
    });
    const branch = agent("B", [retryBegin, info("b1"), spanEnd("retry")], {
      branchedFrom: "F",
    });
    const root = agent("R", [before, anchor("F")], { branches: [branch] });
    const spliced = splice(root, branch).root;
    expect(spanNames(spliced)).toEqual(["before", "retry"]);
    expect(eventIds(spliced)).toContain("b1");
  });

  it("returns null when target is not reachable", () => {
    const root = ts("R", null, []);
    const orphan = ts("O", null, []);
    expect(spliceToTimeline(root, orphan)).toBeNull();
    expect(canSplice(root, orphan)).toBe(false);
  });

  it("returns null when a fork point has no anchor in its parent", () => {
    const branch = agent("B", [info("b1")], { branchedFrom: "F" });
    const lane = agent("L", [info("l1"), info("l2")], { branches: [branch] });
    const root = agent("R", [lane]);
    expect(spliceToTimeline(root, branch)).toBeNull();
    expect(canSplice(root, branch)).toBe(false);
  });
});
