import { describe, expect, it } from "vitest";

import type { TimelineEvent } from "../../components/transcript/timeline";
import type { CompactionEvent, Event, InfoEvent } from "../../types/api-types";

import { getScenarioRoot, S11A_BRANCHES, ts } from "./testHelpers";
import {
  buildSelectionKey,
  collectBranchWithContext,
  computeCompactionRegions,
  getParentKeyFromBranch,
  parseSelection,
} from "./timelineEventNodes";
import { computeFlatSwimlaneRows } from "./utils/swimlaneRows";

// =============================================================================
// Test helpers
// =============================================================================

function makeTimelineEvent(
  eventType: string,
  startSec: number,
  endSec: number,
  tokens = 10
): TimelineEvent {
  const event =
    eventType === "compaction"
      ? ({
          event: "compaction",
          timestamp: ts(startSec).toISOString(),
          working_start: startSec,
          pending: false,
          span_id: null,
          uuid: `compaction-${startSec}`,
          metadata: null,
          source: "",
          tokens_before: null,
          tokens_after: null,
          type: "summary",
        } satisfies CompactionEvent)
      : ({
          event: "info",
          timestamp: ts(startSec).toISOString(),
          working_start: startSec,
          pending: false,
          span_id: null,
          uuid: `info-${startSec}`,
          metadata: null,
          source: "",
          data: "",
        } satisfies InfoEvent);

  return {
    type: "event",
    event,
    startTime: ts(startSec),
    endTime: ts(endSec),
    totalTokens: tokens,
    idleTime: 0,
  };
}

// =============================================================================
// parseSelection
// =============================================================================

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

  it("handles branch key with complex forkedAt UUID", () => {
    expect(
      getParentKeyFromBranch(
        "solvers/agent/branch-550e8400-e29b-41d4-a716-446655440000-1"
      )
    ).toBe("solvers/agent");
  });
});

// =============================================================================
// collectBranchWithContext
// =============================================================================

describe("collectBranchWithContext", () => {
  // Build rows from S11A scenario once — shared across tests.
  const root = getScenarioRoot(S11A_BRANCHES);
  const rows = computeFlatSwimlaneRows(root, { showBranches: true });

  // The build row is the parent, branches are its children.
  // Branch key pattern: "parentKey/branch-{forkedAt}-{index}"
  // In S11A, build is at "transcript/build" and branches fork at "model-call-5".
  const buildRow = rows.find((r) => r.key === "transcript/build");
  const branch1Key = "transcript/build/branch-model-call-5-1";
  const branch1Row = rows.find((r) => r.key === branch1Key);

  it("finds the expected build and branch rows", () => {
    expect(buildRow).toBeDefined();
    expect(branch1Row).toBeDefined();
    expect(branch1Row!.branch).toBe(true);
  });

  it("includes parent events before the branch separator", () => {
    const branch1Span = branch1Row!.spans[0]!;
    const span = "agent" in branch1Span ? branch1Span.agent : undefined;
    expect(span).toBeDefined();

    const result = collectBranchWithContext(rows, branch1Key, span!, {
      includeUtility: false,
      showBranches: false,
      branchPrefix: "",
    });

    // The parent (build) has a model event with uuid "model-call-5" as first content.
    // collectContentUpToFork should emit it, then stop.
    // The first event in the stream should be from the build span's content.
    const eventTypes = result.events.map((e: Event) => e.event);

    // Should start with parent model event (the fork point)
    expect(eventTypes[0]).toBe("model");
    expect((result.events[0] as { uuid: string | null }).uuid).toBe(
      "model-call-5"
    );
  });

  it("includes a branch separator with spanType 'branch'", () => {
    const branch1Span = branch1Row!.spans[0]!;
    const span = "agent" in branch1Span ? branch1Span.agent : undefined;

    const result = collectBranchWithContext(rows, branch1Key, span!, {
      includeUtility: false,
      showBranches: false,
      branchPrefix: "",
    });

    // Find the branch separator — a span_begin with type "branch"
    const separatorIndex = result.events.findIndex(
      (e: Event) => e.event === "span_begin" && e.type === "branch"
    );
    expect(separatorIndex).toBeGreaterThan(0);

    // The separator should come after parent events and before branch content
    const separator = result.events[separatorIndex]!;
    expect(separator.event).toBe("span_begin");
    if (separator.event === "span_begin") {
      expect(separator.span_id).toBe(span!.id);
    }
  });

  it("includes branch content after the separator", () => {
    const branch1Span = branch1Row!.spans[0]!;
    const span = "agent" in branch1Span ? branch1Span.agent : undefined;

    const result = collectBranchWithContext(rows, branch1Key, span!, {
      includeUtility: false,
      showBranches: false,
      branchPrefix: "",
    });

    // Find the branch separator
    const separatorIndex = result.events.findIndex(
      (e: Event) => e.event === "span_begin" && e.type === "branch"
    );

    // After the separator + its end, we should have branch content.
    // Branch 1 content includes agent spans (branch1-refactor, branch1-validate).
    // These are agent spans so they emit as collapsed begin/end pairs.
    const afterSeparator = result.events.slice(separatorIndex + 1);
    const spanBegins = afterSeparator.filter(
      (e: Event) => e.event === "span_begin"
    );
    // Should have at least the two agent spans from branch 1
    expect(spanBegins.length).toBeGreaterThanOrEqual(2);
  });

  it("records source spans for the branch separator", () => {
    const branch1Span = branch1Row!.spans[0]!;
    const span = "agent" in branch1Span ? branch1Span.agent : undefined;

    const result = collectBranchWithContext(rows, branch1Key, span!, {
      includeUtility: false,
      showBranches: false,
      branchPrefix: "",
    });

    // The branch span should be in sourceSpans for rendering as AgentCardView
    expect(result.sourceSpans.has(span!.id)).toBe(true);
  });

  it("fork event is the last parent event before separator", () => {
    const branch1Span = branch1Row!.spans[0]!;
    const span = "agent" in branch1Span ? branch1Span.agent : undefined;

    const result = collectBranchWithContext(rows, branch1Key, span!, {
      includeUtility: false,
      showBranches: false,
      branchPrefix: "",
    });

    // Find the branch separator index
    const separatorIndex = result.events.findIndex(
      (e: Event) => e.event === "span_begin" && e.type === "branch"
    );

    // The event just before the separator should be the fork event
    const forkEvent = result.events[separatorIndex - 1];
    expect(forkEvent).toBeDefined();
    expect((forkEvent as { uuid: string | null }).uuid).toBe("model-call-5");
  });
});
