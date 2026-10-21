import { describe, expect, it } from "vitest";

import {
  testAnchorEvent,
  testCompactionEvent,
  testInfoEvent,
  testModelEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type {
  Event,
  SpanBeginEvent,
  SpanEndEvent,
} from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

import { buildEventNodes } from "../hooks/useEventNodes";
import type { EventNode } from "../types";

import { buildTimeline, TimelineEvent, TimelineSpan } from "./core";
import { computeFlatSwimlaneRows, computeSwimlaneRows } from "./swimlaneRows";
import { makeSpan, rawEventBuilders, ts } from "./testHelpers";
import {
  buildSelectionKey,
  collectPathWithNavigators,
  collectRawEvents,
  computeCompactionRegions,
  findTerminatorTool,
  getParentKeyFromBranch,
  getSelectedSpans,
  isForkNavData,
  parseSelection,
  type EmptyBranchData,
  type ForkNavData,
} from "./timelineEventNodes";

// =============================================================================
// Test helpers
// =============================================================================

function makeTimelineEvent(
  eventType: string,
  startSec: number,
  _endSec: number,
  _tokens = 10
): TimelineEvent {
  const event =
    eventType === "compaction"
      ? testCompactionEvent({
          timestamp: ts(startSec).toISOString(),
          working_start: startSec,
          uuid: `compaction-${startSec}`,
          type: "summary",
        })
      : testInfoEvent({
          timestamp: ts(startSec).toISOString(),
          working_start: startSec,
          uuid: `info-${startSec}`,
        });

  return new TimelineEvent(event);
}

function makeAnchor(
  anchorId: string,
  sec: number,
  spanId: string | null = null
): TimelineEvent {
  return new TimelineEvent(
    testAnchorEvent({
      anchor_id: anchorId,
      timestamp: ts(sec).toISOString(),
      working_start: sec,
      span_id: spanId,
      uuid: `anchor-${anchorId}`,
    })
  );
}

function makeModel(sec: number, label = "m"): TimelineEvent {
  return new TimelineEvent(
    testModelEvent({
      timestamp: ts(sec).toISOString(),
      working_start: sec,
      pending: null,
      span_id: null,
      uuid: `model-${label}-${sec}`,
      metadata: null,
      model: "synthetic",
      role: null,
      error: null,
      cache: null,
      call: null,
      completed: ts(sec).toISOString(),
      working_time: 0,
      retries: null,
      traceback: null,
      traceback_ansi: null,
    })
  );
}

/** A branch span that forks from the given anchor. */
function makeBranch(
  name: string,
  branchedFrom: string,
  startSec: number,
  _endSec: number
): TimelineSpan {
  return new TimelineSpan({
    id: name.toLowerCase(),
    name,
    spanType: "branch",
    content: [makeModel(startSec)],
    branches: [],
    branchedFrom,
    utility: false,
  });
}

// =============================================================================
// parseSelection
// =============================================================================

// The fork/branch markers carry their payload in `metadata`; these check the
// shape the assertions below read, and name what was there when it's wrong.
const expectForkNav = (metadata: unknown): ForkNavData => {
  const data = isRecord(metadata) ? metadata["fork_nav"] : undefined;
  if (!isForkNavData(data)) {
    throw new Error(`not fork_nav metadata: ${JSON.stringify(metadata)}`);
  }
  return data;
};

const expectEmptyBranch = (metadata: unknown): EmptyBranchData => {
  const data = isRecord(metadata) ? metadata["empty_branch"] : undefined;
  if (!isRecord(data) || typeof data["branchName"] !== "string") {
    throw new Error(`not empty_branch metadata: ${JSON.stringify(metadata)}`);
  }
  return { branchName: data["branchName"], terminator: readTerminator(data) };
};

const readTerminator = (data: Record<string, unknown>): string | null =>
  typeof data["terminator"] === "string" ? data["terminator"] : null;

describe("parseSelection", () => {
  it("returns null for null input", () => {
    expect(parseSelection(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSelection("")).toBeNull();
  });

  it("parses a bare row key", () => {
    expect(parseSelection("agent")).toEqual({
      rowKey: "agent",
      spanIndex: null,
      regionIndex: null,
    });
  });

  it("parses a row key with span index", () => {
    expect(parseSelection("agent:1")).toEqual({
      rowKey: "agent",
      spanIndex: 1,
      regionIndex: null,
    });
  });

  it("parses a row key with region index", () => {
    expect(parseSelection("agent@2")).toEqual({
      rowKey: "agent",
      spanIndex: null,
      regionIndex: 2,
    });
  });

  it("parses a row key with span and region index", () => {
    expect(parseSelection("agent:1@3")).toEqual({
      rowKey: "agent",
      spanIndex: 1,
      regionIndex: 3,
    });
  });

  it("handles zero-based indices", () => {
    expect(parseSelection("key:0@0")).toEqual({
      rowKey: "key",
      spanIndex: 0,
      regionIndex: 0,
    });
  });

  it("handles hierarchical row keys with slashes", () => {
    expect(parseSelection("solvers/agent:2@1")).toEqual({
      rowKey: "solvers/agent",
      spanIndex: 2,
      regionIndex: 1,
    });
  });

  it("treats negative region as no region (invalid)", () => {
    // Negative numbers should not parse as valid region indices
    const result = parseSelection("agent@-1");
    expect(result).toEqual({
      rowKey: "agent@-1",
      spanIndex: null,
      regionIndex: null,
    });
  });

  it("treats non-numeric region suffix as part of the key", () => {
    const result = parseSelection("agent@abc");
    expect(result).toEqual({
      rowKey: "agent@abc",
      spanIndex: null,
      regionIndex: null,
    });
  });
});

// =============================================================================
// buildSelectionKey
// =============================================================================

describe("buildSelectionKey", () => {
  it("builds a bare row key", () => {
    expect(buildSelectionKey("agent")).toBe("agent");
  });

  it("builds a key with span index", () => {
    expect(buildSelectionKey("agent", 1)).toBe("agent:1");
  });

  it("builds a key with region index only", () => {
    expect(buildSelectionKey("agent", undefined, 2)).toBe("agent@2");
  });

  it("builds a key with span and region index", () => {
    expect(buildSelectionKey("agent", 1, 3)).toBe("agent:1@3");
  });

  it("roundtrips through parseSelection", () => {
    const key = buildSelectionKey("solvers/sub", 2, 4);
    const parsed = parseSelection(key);
    expect(parsed).toEqual({
      rowKey: "solvers/sub",
      spanIndex: 2,
      regionIndex: 4,
    });
  });
});

// =============================================================================
// computeCompactionRegions
// =============================================================================

describe("computeCompactionRegions", () => {
  it("returns a single region when there are no compaction events", () => {
    const events = [
      makeTimelineEvent("info", 0, 1),
      makeTimelineEvent("info", 1, 2),
      makeTimelineEvent("info", 2, 3),
    ];

    const regions = computeCompactionRegions(events);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual(events);
  });

  it("returns empty single region for empty content", () => {
    const regions = computeCompactionRegions([]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual([]);
  });

  it("splits at one compaction event into two regions", () => {
    const e1 = makeTimelineEvent("info", 0, 1);
    const compaction = makeTimelineEvent("compaction", 1, 1);
    const e2 = makeTimelineEvent("info", 1, 2);

    const regions = computeCompactionRegions([e1, compaction, e2]);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual([e1]);
    expect(regions[1]).toEqual([e2]);
  });

  it("splits at multiple compaction events", () => {
    const e1 = makeTimelineEvent("info", 0, 1);
    const c1 = makeTimelineEvent("compaction", 1, 1);
    const e2 = makeTimelineEvent("info", 1, 2);
    const c2 = makeTimelineEvent("compaction", 2, 2);
    const e3 = makeTimelineEvent("info", 2, 3);
    const c3 = makeTimelineEvent("compaction", 3, 3);
    const e4 = makeTimelineEvent("info", 3, 4);

    const regions = computeCompactionRegions([e1, c1, e2, c2, e3, c3, e4]);
    expect(regions).toHaveLength(4);
    expect(regions[0]).toEqual([e1]);
    expect(regions[1]).toEqual([e2]);
    expect(regions[2]).toEqual([e3]);
    expect(regions[3]).toEqual([e4]);
  });

  it("handles consecutive compactions (empty regions)", () => {
    const e1 = makeTimelineEvent("info", 0, 1);
    const c1 = makeTimelineEvent("compaction", 1, 1);
    const c2 = makeTimelineEvent("compaction", 1, 1);
    const e2 = makeTimelineEvent("info", 1, 2);

    const regions = computeCompactionRegions([e1, c1, c2, e2]);
    expect(regions).toHaveLength(3);
    expect(regions[0]).toEqual([e1]);
    expect(regions[1]).toEqual([]); // empty region between consecutive compactions
    expect(regions[2]).toEqual([e2]);
  });

  it("handles compaction at the start", () => {
    const c = makeTimelineEvent("compaction", 0, 0);
    const e = makeTimelineEvent("info", 0, 1);

    const regions = computeCompactionRegions([c, e]);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual([]); // empty region before the compaction
    expect(regions[1]).toEqual([e]);
  });

  it("handles compaction at the end", () => {
    const e = makeTimelineEvent("info", 0, 1);
    const c = makeTimelineEvent("compaction", 1, 1);

    const regions = computeCompactionRegions([e, c]);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual([e]);
    expect(regions[1]).toEqual([]); // empty region after the compaction
  });

  it("excludes compaction events from regions", () => {
    const e1 = makeTimelineEvent("info", 0, 1);
    const c = makeTimelineEvent("compaction", 1, 1);
    const e2 = makeTimelineEvent("info", 1, 2);

    const regions = computeCompactionRegions([e1, c, e2]);
    // Compaction events should not appear in any region
    for (const region of regions) {
      for (const item of region) {
        if (item.type === "event") {
          expect(item.event.event).not.toBe("compaction");
        }
      }
    }
  });
});

// =============================================================================
// getParentKeyFromBranch
// =============================================================================

describe("getParentKeyFromBranch", () => {
  it("extracts parent key from a branch key", () => {
    expect(getParentKeyFromBranch("main/build/branch-uuid-1")).toBe(
      "main/build"
    );
  });

  it("returns null for a non-branch key", () => {
    expect(getParentKeyFromBranch("main/build")).toBeNull();
  });

  it("returns null for a bare key", () => {
    expect(getParentKeyFromBranch("build")).toBeNull();
  });

  it("handles nested branch keys", () => {
    expect(getParentKeyFromBranch("root/branch-abc-1/branch-def-2")).toBe(
      "root/branch-abc-1"
    );
  });

  it("handles branch key with complex branchedFrom UUID", () => {
    expect(
      getParentKeyFromBranch(
        "solvers/agent/branch-550e8400-e29b-41d4-a716-446655440000-1"
      )
    ).toBe("solvers/agent");
  });
});

describe("collectPathWithNavigators — adjacent fork merge", () => {
  // Root span with two back-to-back anchors and one branch off each.
  // No non-anchor event sits between the two anchors, so the two
  // fork-navs should collapse into a single node with two groups.
  function rowsWithTwoAdjacentForks() {
    const branchA1 = makeBranch("B1", "A1", 2, 3);
    const branchA2 = makeBranch("B2", "A2", 4, 5);
    const root = new TimelineSpan({
      id: "root",
      name: "Root",
      spanType: "agent",
      content: [makeAnchor("A1", 2), makeAnchor("A2", 3), makeModel(4, "tail")],
      branches: [branchA1, branchA2],
      utility: false,
    });
    const transcript = makeSpan("Transcript", 0, 10, 0, [root]);
    return computeSwimlaneRows(transcript);
  }

  it("merges two anchor forks at the same parent into one fork_nav node", () => {
    const rows = rowsWithTwoAdjacentForks();
    const { events } = collectPathWithNavigators(rows, "root");

    const forkBegins = events.filter(
      (e): e is SpanBeginEvent =>
        e.event === "span_begin" && e.type === "fork_nav"
    );
    expect(forkBegins).toHaveLength(1);

    const data = expectForkNav(forkBegins[0]!.metadata);
    expect(data.groups).toHaveLength(2);
    expect(data.groups.map((g) => g.anchorId)).toEqual(["A1", "A2"]);
  });

  it("does not merge when a non-fork event sits between two anchors", () => {
    const branchA1 = makeBranch("B1", "A1", 2, 3);
    const branchA2 = makeBranch("B2", "A2", 6, 7);
    const root = new TimelineSpan({
      id: "root",
      name: "Root",
      spanType: "agent",
      content: [
        makeAnchor("A1", 2),
        makeModel(4, "between"),
        makeAnchor("A2", 5),
      ],
      branches: [branchA1, branchA2],
      utility: false,
    });
    const transcript = makeSpan("Transcript", 0, 10, 0, [root]);
    const rows = computeSwimlaneRows(transcript);

    const { events } = collectPathWithNavigators(rows, "root");
    const forkBegins = events.filter(
      (e): e is SpanBeginEvent =>
        e.event === "span_begin" && e.type === "fork_nav"
    );
    expect(forkBegins).toHaveLength(2);
  });

  it("does not merge across differing parent_ids", () => {
    // Restart-style fork emits with parent_id = null; anchor fork emits with
    // parent_id = stripped anchor span_id. The anchor must carry a non-null
    // span_id so the two parent_ids differ and the merge is skipped.
    const restartBranch = makeBranch("BR", "", 0, 1);
    const anchorBranch = makeBranch("BA", "A1", 3, 4);
    const root = new TimelineSpan({
      id: "root",
      name: "Root",
      spanType: "agent",
      content: [makeAnchor("A1", 2, "root")],
      branches: [restartBranch, anchorBranch],
      utility: false,
    });
    const transcript = makeSpan("Transcript", 0, 10, 0, [root]);
    const rows = computeSwimlaneRows(transcript);

    const { events } = collectPathWithNavigators(rows, "root");
    const forkBegins = events.filter(
      (e): e is SpanBeginEvent =>
        e.event === "span_begin" && e.type === "fork_nav"
    );
    expect(forkBegins).toHaveLength(2);
  });

  it("merged groups carry independent selectedIndex values", () => {
    const branchA1 = makeBranch("B1", "A1", 2, 3);
    const branchA2 = makeBranch("B2", "A2", 4, 5);
    const root = new TimelineSpan({
      id: "root",
      name: "Root",
      spanType: "agent",
      content: [makeAnchor("A1", 2), makeAnchor("A2", 3), makeModel(4, "tail")],
      branches: [branchA1, branchA2],
      utility: false,
    });
    const transcript = makeSpan("Transcript", 0, 10, 0, [root]);
    const rows = computeFlatSwimlaneRows(transcript, { showBranches: true });

    const branchRowKey = "transcript/root/branch-A2-2";
    const { events } = collectPathWithNavigators(rows, branchRowKey);

    const forkBegin = events.find(
      (e): e is SpanBeginEvent =>
        e.event === "span_begin" && e.type === "fork_nav"
    );
    if (!forkBegin) throw new Error("expected a fork_nav span_begin");
    const data = expectForkNav(forkBegin.metadata);

    expect(data.groups[0]!.selectedIndex).toBe(0);
    expect(data.groups[1]!.selectedIndex).toBe(1);
  });

  it("does not merge across segment boundaries", () => {
    // Multi-segment path where the cut anchor has span_id=null and the
    // selected branch opens with a restart-style fork. Both navs end up
    // with parent_id=null, so the parent_id guard alone would merge them
    // — the segIdx guard must prevent that.
    const restartBranchOnB1 = makeBranch("BR", "", 4, 5);
    const branchB1 = new TimelineSpan({
      id: "b1",
      name: "B1",
      spanType: "branch",
      content: [makeModel(3, "b1tail")],
      branches: [restartBranchOnB1],
      branchedFrom: "A1",
      utility: false,
    });
    const root = new TimelineSpan({
      id: "root",
      name: "Root",
      spanType: "agent",
      content: [makeAnchor("A1", 2)],
      branches: [branchB1],
      utility: false,
    });
    const transcript = makeSpan("Transcript", 0, 10, 0, [root]);
    const rows = computeFlatSwimlaneRows(transcript, { showBranches: true });

    const branchRowKey = "transcript/root/branch-A1-1/branch--1";
    const { events } = collectPathWithNavigators(rows, branchRowKey);
    const forkBegins = events.filter(
      (e): e is SpanBeginEvent =>
        e.event === "span_begin" && e.type === "fork_nav"
    );
    expect(forkBegins).toHaveLength(2);
  });
});

// =============================================================================
// findTerminatorTool
// =============================================================================

function makeTool(spanId: string, fn: string, sec: number): TimelineEvent {
  return new TimelineEvent(
    testToolEvent({
      function: fn,
      id: `call-${fn}-${sec}`,
      timestamp: ts(sec).toISOString(),
      working_start: sec,
      completed: ts(sec).toISOString(),
      span_id: spanId,
      uuid: `tool-${spanId}-${sec}`,
    })
  );
}

/** Begin/end events delimiting a trajectory span `id` (span_id === id). */
function trajectoryBegin(id: string, sec: number): SpanBeginEvent {
  return testSpanBeginEvent({
    name: "trajectory",
    id,
    span_id: id,
    type: "trajectory",
    timestamp: ts(sec).toISOString(),
    working_start: sec,
    uuid: id,
  });
}

function trajectoryEnd(id: string, sec: number): SpanEndEvent {
  return testSpanEndEvent({
    id,
    span_id: id,
    timestamp: ts(sec).toISOString(),
    working_start: sec,
  });
}

describe("findTerminatorTool", () => {
  it("returns the function name of the last tool event inside the trajectory range", () => {
    const events: Event[] = [
      trajectoryBegin("traj-1", 0),
      makeTool("inner-1", "send_message", 1).event,
      makeTool("inner-2", "rollback_conversation", 2).event,
      makeTool("inner-3", "restart_conversation", 3).event,
      trajectoryEnd("traj-1", 4),
    ];
    expect(findTerminatorTool(events, "traj-1")).toBe("restart_conversation");
  });

  it("returns null when no tool sits inside the trajectory range", () => {
    const events: Event[] = [
      trajectoryBegin("traj-1", 0),
      trajectoryEnd("traj-1", 1),
    ];
    expect(findTerminatorTool(events, "traj-1")).toBeNull();
  });

  it("returns null when the trajectory span is not present", () => {
    expect(findTerminatorTool([], "missing")).toBeNull();
  });

  it("ignores tools outside the trajectory range", () => {
    const events: Event[] = [
      makeTool("outside-1", "before_tool", 0).event,
      trajectoryBegin("traj-1", 1),
      trajectoryEnd("traj-1", 2),
      makeTool("outside-2", "after_tool", 3).event,
    ];
    expect(findTerminatorTool(events, "traj-1")).toBeNull();
  });
});

describe("collectPathWithNavigators — empty leaf marker", () => {
  function rowsWithEmptyLeafBranch() {
    // Parent span has an anchor; one branch forks from that anchor and
    // contains nothing visible (just structural events / empty content).
    const emptyBranch = new TimelineSpan({
      id: "empty",
      name: "Branch 2",
      spanType: "branch",
      content: [],
      branches: [],
      branchedFrom: "A1",
      utility: false,
    });
    const root = new TimelineSpan({
      id: "root",
      name: "Root",
      spanType: "agent",
      content: [makeAnchor("A1", 2), makeModel(4, "tail")],
      branches: [emptyBranch],
      utility: false,
    });
    const transcript = makeSpan("Transcript", 0, 10, 0, [root]);
    return computeFlatSwimlaneRows(transcript, { showBranches: true });
  }

  it("emits an empty_branch synthetic span when the leaf segment has no visible content", () => {
    const rows = rowsWithEmptyLeafBranch();
    const { events } = collectPathWithNavigators(
      rows,
      "transcript/root/branch-A1-1"
    );
    const markers = events.filter(
      (e): e is SpanBeginEvent =>
        e.event === "span_begin" && e.type === "empty_branch"
    );
    expect(markers).toHaveLength(1);
    const data = expectEmptyBranch(markers[0]!.metadata);
    expect(data.branchName).toBe("Branch 2");
    expect(data.terminator).toBeNull();
  });

  it("passes terminator name into the marker when rawEvents is supplied", () => {
    const rows = rowsWithEmptyLeafBranch();
    const trajBegin = trajectoryBegin("empty", 2);
    const tool = makeTool("inner-tool", "restart_conversation", 3).event;
    const trajEnd = trajectoryEnd("empty", 4);
    const raw: Event[] = [trajBegin, tool, trajEnd];

    const { events } = collectPathWithNavigators(
      rows,
      "transcript/root/branch-A1-1",
      raw
    );
    const marker = events.find(
      (e): e is SpanBeginEvent =>
        e.event === "span_begin" && e.type === "empty_branch"
    );
    expect(marker).toBeDefined();
    const data = expectEmptyBranch(marker!.metadata);
    expect(data.terminator).toBe("restart_conversation");
  });

  it("does NOT emit an empty_branch marker when the leaf segment has visible content", () => {
    const branchWithContent = new TimelineSpan({
      id: "filled",
      name: "Branch 2",
      spanType: "branch",
      content: [makeModel(3, "inside")],
      branches: [],
      branchedFrom: "A1",
      utility: false,
    });
    const root = new TimelineSpan({
      id: "root",
      name: "Root",
      spanType: "agent",
      content: [makeAnchor("A1", 2), makeModel(4, "tail")],
      branches: [branchWithContent],
      utility: false,
    });
    const transcript = makeSpan("Transcript", 0, 10, 0, [root]);
    const rows = computeFlatSwimlaneRows(transcript, { showBranches: true });
    const { events } = collectPathWithNavigators(
      rows,
      "transcript/root/branch-A1-1"
    );
    const markers = events.filter(
      (e) => e.event === "span_begin" && e.type === "empty_branch"
    );
    expect(markers).toHaveLength(0);
  });

  it("does NOT emit an empty_branch marker for empty NON-leaf segments", () => {
    // Intermediate branch is empty (only an anchor); its child branch has
    // content. The leaf is the child, which is non-empty → no marker.
    const leaf = new TimelineSpan({
      id: "leaf",
      name: "Branch 3",
      spanType: "branch",
      content: [makeModel(4, "leafmodel")],
      branches: [],
      branchedFrom: "A2",
      utility: false,
    });
    const empty = new TimelineSpan({
      id: "empty",
      name: "Branch 2",
      spanType: "branch",
      content: [makeAnchor("A2", 3)],
      branches: [leaf],
      branchedFrom: "A1",
      utility: false,
    });
    const root = new TimelineSpan({
      id: "root",
      name: "Root",
      spanType: "agent",
      content: [makeAnchor("A1", 2), makeModel(5, "tail")],
      branches: [empty],
      utility: false,
    });
    const transcript = makeSpan("Transcript", 0, 10, 0, [root]);
    const rows = computeFlatSwimlaneRows(transcript, { showBranches: true });
    const { events } = collectPathWithNavigators(
      rows,
      "transcript/root/branch-A1-1/branch-A2-1"
    );
    const markers = events.filter(
      (e) => e.event === "span_begin" && e.type === "empty_branch"
    );
    expect(markers).toHaveLength(0);
  });
});

// =============================================================================
// collectRawEvents — utility span elision
// =============================================================================

describe("collectRawEvents — utility span elision", () => {
  const utilitySpan = (id: string, sec: number) =>
    new TimelineSpan({
      id,
      name: "utility",
      spanType: "agent",
      content: [makeModel(sec, id)],
      branches: [],
      utility: true,
    });

  const mainSpan = (content: (TimelineEvent | TimelineSpan)[]) =>
    new TimelineSpan({
      id: "main",
      name: "main",
      spanType: "agent",
      content,
      branches: [],
      utility: false,
    });

  it("elides utility spans when utility agents are off", () => {
    const root = mainSpan([
      makeModel(0, "a"),
      utilitySpan("u1", 1),
      utilitySpan("u2", 2),
      makeModel(3, "b"),
    ]);
    const { events } = collectRawEvents([root]);
    expect(events.filter((e) => e.event === "model")).toHaveLength(2);
    expect(events.filter((e) => e.event === "span_begin")).toHaveLength(0);
  });

  it("emits utility spans when utility agents are on", () => {
    const root = mainSpan([
      makeModel(0, "a"),
      utilitySpan("u1", 1),
      utilitySpan("u2", 2),
      makeModel(3, "b"),
    ]);
    const { events } = collectRawEvents([root], { includeUtility: true });
    expect(events.filter((e) => e.event === "span_begin")).toHaveLength(2);
  });
});

describe("collectRawEvents — agent cards inside checkpoint spans", () => {
  // A main agent dispatching two subagents through tool calls. The turns run
  // directly in the agent span, inside a checkpoint span, or (after a
  // checkpoint resume) inside checkpoint spans that a `prior_run` wrap holds,
  // followed by a live checkpoint span. The shape matches what Inspect logs:
  // the ToolEvent sits in the enclosing span and is timestamped before the
  // spans its call opens.
  const sampleEvents = ({
    layout = "plain",
    dispatch,
  }: {
    layout?: "plain" | "checkpoint" | "resumed";
    dispatch: "agent" | "handoff" | "collect";
  }): Event[] => {
    const { base, spanBegin, spanEnd } = rawEventBuilders();
    const model = (spanId: string): Event =>
      testModelEvent({ ...base(), span_id: spanId });
    const agentSpan = (id: string, parentId: string): Event[] => [
      spanBegin(id, "general", "agent", parentId),
      model(id),
      spanEnd(id),
    ];
    const toolCall = (
      n: number,
      parent: string,
      agentSpanId: string | null
    ): Event =>
      testToolEvent({
        ...base(),
        id: `call_${n}`,
        function: "agent",
        span_id: parent,
        agent_span_id: agentSpanId,
      });
    // `agent` tool: tool span > agent span.
    // handoff: handoff span > tool span > agent span.
    // collect() in a user tool: tool span > task spans > agent spans.
    const subagentCall = (n: number, parent: string): Event[] => {
      const turn = model(parent);
      if (dispatch === "collect") {
        const call = toolCall(n, parent, null);
        return [
          turn,
          spanBegin(`tool${n}`, "fan_out", "tool", parent),
          call,
          ...[1, 2].flatMap((t) => [
            spanBegin(`task${n}.${t}`, `task-${t}`, "task", `tool${n}`),
            ...agentSpan(`sub${n}.${t}`, `task${n}.${t}`),
            spanEnd(`task${n}.${t}`),
          ]),
          spanEnd(`tool${n}`),
        ];
      }
      const call = toolCall(n, parent, `sub${n}`);
      const toolSpanParent = dispatch === "handoff" ? `handoff${n}` : parent;
      const toolSpan = [
        spanBegin(`tool${n}`, "agent", "tool", toolSpanParent),
        call,
        ...agentSpan(`sub${n}`, `tool${n}`),
        spanEnd(`tool${n}`),
      ];
      return [
        turn,
        ...(dispatch === "handoff"
          ? [
              spanBegin(`handoff${n}`, "general", "handoff", parent),
              ...toolSpan,
              spanEnd(`handoff${n}`),
            ]
          : toolSpan),
      ];
    };
    const layouts = {
      plain: () => [
        ...subagentCall(1, "main"),
        ...subagentCall(2, "main"),
        model("main"),
      ],
      checkpoint: () => [
        spanBegin("ck1", "checkpoint 1", "checkpoint", "main"),
        ...subagentCall(1, "ck1"),
        ...subagentCall(2, "ck1"),
        model("ck1"),
        spanEnd("ck1"),
      ],
      // Each restored checkpoint span is followed by its CheckpointEvent,
      // which hydrate moves into the wrap (an info event stands in for it).
      resumed: () => [
        spanBegin("restore", "checkpoint restore 1", "prior_run", "main"),
        spanBegin("ck1", "checkpoint 1", "checkpoint", "restore"),
        ...subagentCall(1, "ck1"),
        spanEnd("ck1"),
        testInfoEvent({ ...base(), span_id: "restore" }),
        spanBegin("ck2", "checkpoint 2", "checkpoint", "restore"),
        ...subagentCall(2, "ck2"),
        spanEnd("ck2"),
        testInfoEvent({ ...base(), span_id: "restore" }),
        spanEnd("restore"),
        spanBegin("ck3", "checkpoint 3", "checkpoint", "main"),
        model("ck3"),
        spanEnd("ck3"),
      ],
    };
    return [
      spanBegin("solvers", "solvers", "solvers", null),
      spanBegin("main", "main", "agent", "solvers"),
      ...layouts[layout](),
      spanEnd("main"),
      spanEnd("solvers"),
    ];
  };

  // Tool calls and agent cards in render order, with their tree depth.
  const renderedCalls = (events: Event[]): string[] => {
    const rows = computeSwimlaneRows(buildTimeline(events).root);
    const collected = collectRawEvents(getSelectedSpans(rows, rows[0]!.key));
    const { eventNodes } = buildEventNodes(
      collected.events,
      false,
      collected.sourceSpans
    );
    const label = ({ event, sourceSpan }: EventNode): string | null => {
      if (event.event === "tool") return `tool ${event.id}`;
      if (event.event === "span_begin" && sourceSpan) return `card ${event.id}`;
      return null;
    };
    const walk = (nodes: EventNode[], depth: number): string[] =>
      nodes.flatMap((node) => {
        const own = label(node);
        return [
          ...(own ? [`${depth} ${own}`] : []),
          ...walk(node.children, depth + 1),
        ];
      });
    return walk(eventNodes, 0);
  };

  const besideToolCalls = [
    "0 tool call_1",
    "0 card sub1",
    "0 tool call_2",
    "0 card sub2",
  ];

  // Once discard_checkpoint_span flattens the checkpoint spans, a checkpointed
  // log reads as if it had none, and a resumed one as if its restored turns
  // ran inside the "checkpoint restore" span.
  it.each([
    { dispatch: "agent", expected: besideToolCalls },
    { dispatch: "handoff", expected: besideToolCalls },
    {
      dispatch: "collect",
      expected: [
        "0 tool call_1",
        "0 card sub1.1",
        "0 card sub1.2",
        "0 tool call_2",
        "0 card sub2.1",
        "0 card sub2.2",
      ],
    },
  ] as const)(
    "renders $dispatch cards beside their tool call, with or without checkpointing",
    ({ dispatch, expected }) => {
      expect(renderedCalls(sampleEvents({ dispatch }))).toEqual(expected);
      expect(
        renderedCalls(sampleEvents({ layout: "checkpoint", dispatch }))
      ).toEqual(expected);
      expect(
        renderedCalls(sampleEvents({ layout: "resumed", dispatch }))
      ).toEqual(expected.map((line) => line.replace(/^0 /, "1 ")));
    }
  );
});
