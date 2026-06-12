import { describe, expect, it } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";

import {
  findTimelineIndexForEvent,
  findTimelineIndexForMessage,
  timelineContainsEvent,
} from "./findTimelineForDeepLink";
import { TimelineEvent, TimelineSpan, type Timeline } from "./timeline/core";

// Minimal model-event factory; mirrors the `as unknown as Event` pattern in
// timeline/testHelpers.ts (only the fields the lookup reads are populated).
function modelEvent(
  uuid: string,
  opts?: { inputId?: string; outputId?: string }
): Event {
  return {
    event: "model",
    uuid,
    timestamp: "2025-01-01T00:00:00Z",
    input: opts?.inputId
      ? [{ id: opts.inputId, role: "user", content: "hi" }]
      : [],
    output: {
      choices: opts?.outputId
        ? [
            {
              message: { id: opts.outputId, role: "assistant", content: "ok" },
            },
          ]
        : [],
    },
  } as unknown as Event;
}

function span(
  id: string,
  content: (TimelineEvent | TimelineSpan)[],
  opts?: { branches?: TimelineSpan[]; spanType?: string | null }
): TimelineSpan {
  return new TimelineSpan({
    id,
    name: id,
    spanType: opts?.spanType ?? null,
    content,
    branches: opts?.branches,
  });
}

function timeline(name: string, root: TimelineSpan): Timeline {
  return { name, description: "", root };
}

const targetTl = timeline(
  "target",
  span("root-target", [new TimelineEvent(modelEvent("ev-t1"))])
);
const auditorTl = timeline(
  "auditor",
  span("root-auditor", [
    new TimelineEvent(modelEvent("ev-a1", { outputId: "msg-a1" })),
    span("agent-call1", [new TimelineEvent(modelEvent("ev-a2"))], {
      spanType: "agent",
    }),
  ])
);
const timelines: Timeline[] = [targetTl, auditorTl];

describe("timelineContainsEvent", () => {
  it("matches event uuids in nested spans", () => {
    expect(timelineContainsEvent("ev-a2", auditorTl)).toBe(true);
    expect(timelineContainsEvent("ev-a2", targetTl)).toBe(false);
  });

  it("matches span ids (agent-card deep-link targets)", () => {
    expect(timelineContainsEvent("agent-call1", auditorTl)).toBe(true);
    expect(timelineContainsEvent("agent-call1", targetTl)).toBe(false);
  });

  it("matches events inside branches", () => {
    const branched = timeline(
      "branched",
      span("root-b", [], {
        branches: [span("b1", [new TimelineEvent(modelEvent("ev-br1"))])],
      })
    );
    expect(timelineContainsEvent("ev-br1", branched)).toBe(true);
  });
});

describe("findTimelineIndexForEvent", () => {
  it("returns the index of the containing timeline", () => {
    expect(findTimelineIndexForEvent("ev-a1", timelines)).toBe(1);
    expect(findTimelineIndexForEvent("ev-t1", timelines)).toBe(0);
  });

  it("returns the first match when present in multiple timelines", () => {
    const dup = timeline(
      "dup",
      span("root-dup", [new TimelineEvent(modelEvent("ev-t1"))])
    );
    expect(findTimelineIndexForEvent("ev-t1", [targetTl, dup])).toBe(0);
  });

  it("returns -1 when no timeline contains the event", () => {
    expect(findTimelineIndexForEvent("ev-missing", timelines)).toBe(-1);
  });
});

describe("findTimelineIndexForMessage", () => {
  it("returns the index of the timeline whose events carry the message", () => {
    expect(findTimelineIndexForMessage("msg-a1", timelines)).toBe(1);
  });

  it("returns -1 when no timeline carries the message", () => {
    expect(findTimelineIndexForMessage("msg-missing", timelines)).toBe(-1);
  });
});
