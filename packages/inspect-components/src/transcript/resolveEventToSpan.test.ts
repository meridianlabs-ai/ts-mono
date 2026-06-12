import { describe, expect, it } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";

import {
  resolveEventInBranches,
  resolveEventToSpan,
} from "./resolveMessageToEvent";
import { TimelineEvent, TimelineSpan } from "./timeline/core";
import { computeFlatSwimlaneRows } from "./timeline/swimlaneRows";

const event = (uuid: string): TimelineEvent =>
  new TimelineEvent({
    event: "info",
    uuid,
    timestamp: "2026-01-01T00:00:00Z",
    working_start: 0,
  } as unknown as Event);

const span = (
  id: string,
  content: (TimelineEvent | TimelineSpan)[],
  opts?: {
    spanType?: string | null;
    branches?: TimelineSpan[];
    branchedFrom?: string;
  }
): TimelineSpan =>
  new TimelineSpan({
    id,
    name: id,
    spanType: opts?.spanType ?? null,
    content,
    branches: opts?.branches,
    branchedFrom: opts?.branchedFrom,
  });

describe("resolveEventToSpan", () => {
  const root = span(
    "root",
    [
      event("ev-root"),
      span("agent-1", [event("ev-agent")], { spanType: "agent" }),
      span(
        "agent-outer",
        [span("agent-inner", [event("ev-nested")], { spanType: "agent" })],
        { spanType: "agent" }
      ),
      span("init-span", [event("ev-transparent")], { spanType: "init" }),
    ],
    { spanType: "root" }
  );

  it("resolves a root-level event with no agent span", () => {
    expect(resolveEventToSpan("ev-root", root)).toEqual({
      eventId: "ev-root",
      agentSpanId: null,
    });
  });

  it("resolves an event inside an agent span to that span", () => {
    expect(resolveEventToSpan("ev-agent", root)).toEqual({
      eventId: "ev-agent",
      agentSpanId: "agent-1",
    });
  });

  it("uses the outermost agent span for nested agents", () => {
    expect(resolveEventToSpan("ev-nested", root)).toEqual({
      eventId: "ev-nested",
      agentSpanId: "agent-outer",
    });
  });

  it("treats non-agent spans as transparent", () => {
    expect(resolveEventToSpan("ev-transparent", root)).toEqual({
      eventId: "ev-transparent",
      agentSpanId: null,
    });
  });

  it("resolves a span-id target (agent card) to its agent context", () => {
    expect(resolveEventToSpan("agent-inner", root)).toEqual({
      eventId: "agent-inner",
      agentSpanId: "agent-outer",
    });
  });

  it("returns undefined for an unknown event", () => {
    expect(resolveEventToSpan("ev-missing", root)).toBeUndefined();
  });
});

describe("resolveEventInBranches", () => {
  const branchSpan = span("branch-agent", [event("ev-branch")], {
    spanType: "agent",
    branchedFrom: "anchor-1",
  });
  const root = span("root", [event("ev-main")], {
    spanType: "root",
    branches: [branchSpan],
  });

  it("resolves an event inside a branch to that branch row", () => {
    const result = resolveEventInBranches("ev-branch", root);
    expect(result?.eventId).toBe("ev-branch");
    const branchRow = computeFlatSwimlaneRows(root, {
      includeUtility: true,
      showBranches: true,
    }).find((row) => row.branch);
    expect(branchRow).toBeDefined();
    expect(result?.branchRowKey).toBe(branchRow?.key);
  });

  it("returns undefined for events not in any branch", () => {
    expect(resolveEventInBranches("ev-main", root)).toBeUndefined();
  });
});
