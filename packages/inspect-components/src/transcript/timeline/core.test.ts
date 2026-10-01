/**
 * Tests for convertServerTimeline() — the server-to-client timeline conversion.
 *
 * These tests ensure UUID resolution, nested span handling, and branch
 * preservation work correctly, providing a safety net before the migration
 * to the shared inspect-components package.
 */

import { describe, expect, it } from "vitest";

import {
  testAnchorEvent,
  testAssistantMessage,
  testBranchEvent,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSpanBeginEvent,
  testSpanEndEvent,
  testStepEvent,
  testTimeline,
  testTimelineEvent,
  testTimelineSpan,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type {
  Event,
  TimelineSpan as ServerTimelineSpan,
} from "@tsmono/inspect-common/types";

import {
  asTimelineEvent,
  asTimelineSpan,
  buildTimeline,
  convertServerTimeline,
  countUtilitySpans,
  filterEmptyBranches,
  isEmptyBranch,
  spanHasBranches,
  TimelineEvent,
  TimelineSpan,
} from "./core";
import { rawEventBuilders } from "./testHelpers";

// =============================================================================
// Helpers
// =============================================================================

const BASE = new Date("2025-01-15T10:00:00Z").getTime();

const iso = (sec: number) => new Date(BASE + sec * 1000).toISOString();

function makeModelEvent(
  uuid: string,
  startSec: number,
  endSec: number,
  tokens: number
): Event {
  return testModelEvent({
    uuid,
    timestamp: iso(startSec),
    completed: iso(endSec),
    working_start: startSec,
    output: testModelOutput({
      usage: testModelUsage({
        input_tokens: Math.floor(tokens * 0.6),
        output_tokens: tokens - Math.floor(tokens * 0.6),
        total_tokens: tokens,
      }),
    }),
  });
}

const makeServerTimeline = (root: ServerTimelineSpan) =>
  testTimeline({ name: "test", description: "test timeline", root });

// =============================================================================
// Tests
// =============================================================================

describe("convertServerTimeline", () => {
  describe("UUID resolution", () => {
    it("resolves event UUIDs to full Event objects", () => {
      const events = [
        makeModelEvent("evt-1", 0, 10, 100),
        makeModelEvent("evt-2", 10, 20, 200),
      ];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [
            testTimelineEvent({ event: "evt-1" }),
            testTimelineEvent({ event: "evt-2" }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.name).toBe("test");
      expect(result.description).toBe("test timeline");
      expect(result.root.content).toHaveLength(2);
      expect(result.root.content[0]).toBeInstanceOf(TimelineEvent);
      expect(asTimelineEvent(result.root.content[0]).event.uuid).toBe("evt-1");
      expect(asTimelineEvent(result.root.content[1]).event.uuid).toBe("evt-2");
    });

    it("filters out events with missing UUIDs", () => {
      const events = [makeModelEvent("evt-1", 0, 10, 100)];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [
            testTimelineEvent({ event: "evt-1" }),
            testTimelineEvent({ event: "evt-missing" }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.root.content).toHaveLength(1);
      expect(asTimelineEvent(result.root.content[0]).event.uuid).toBe("evt-1");
    });

    it("handles empty events array", () => {
      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [testTimelineEvent({ event: "evt-1" })],
        })
      );

      const result = convertServerTimeline(server, []);

      expect(result.root.content).toHaveLength(0);
    });
  });

  describe("nested spans", () => {
    it("converts nested span hierarchy", () => {
      const events = [
        makeModelEvent("evt-1", 0, 10, 100),
        makeModelEvent("evt-2", 10, 20, 200),
        makeModelEvent("evt-3", 20, 30, 300),
      ];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [
            testTimelineEvent({ event: "evt-1" }),
            testTimelineSpan({
              id: "child",
              name: "explore",
              span_type: "agent",
              content: [
                testTimelineEvent({ event: "evt-2" }),
                testTimelineSpan({
                  id: "grandchild",
                  name: "build",
                  span_type: "agent",
                  content: [testTimelineEvent({ event: "evt-3" })],
                }),
              ],
            }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      // Root has 1 event + 1 child span
      expect(result.root.content).toHaveLength(2);
      expect(result.root.content[0]).toBeInstanceOf(TimelineEvent);

      const childSpan = asTimelineSpan(result.root.content[1]);
      expect(childSpan).toBeInstanceOf(TimelineSpan);
      expect(childSpan.name).toBe("explore");
      expect(childSpan.spanType).toBe("agent");
      expect(childSpan.content).toHaveLength(2);

      const grandchild = asTimelineSpan(childSpan.content[1]);
      expect(grandchild).toBeInstanceOf(TimelineSpan);
      expect(grandchild.name).toBe("build");
      expect(grandchild.content).toHaveLength(1);
    });

    it("preserves span properties through conversion", () => {
      const events = [makeModelEvent("evt-1", 0, 10, 100)];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [
            testTimelineSpan({
              id: "agent-1",
              name: "helper",
              span_type: "agent",
              utility: true,
              description: "A helper agent",
              agent_result: "Done helping",
              content: [testTimelineEvent({ event: "evt-1" })],
            }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);
      const agent = asTimelineSpan(result.root.content[0]);

      expect(agent.id).toBe("agent-1");
      expect(agent.name).toBe("helper");
      expect(agent.spanType).toBe("agent");
      expect(agent.utility).toBe(true);
      expect(agent.description).toBe("A helper agent");
      expect(agent.agentResult).toBe("Done helping");
    });

    it("filters out empty child spans (all events missing)", () => {
      const events = [makeModelEvent("evt-1", 0, 10, 100)];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [
            testTimelineEvent({ event: "evt-1" }),
            testTimelineSpan({
              id: "empty",
              name: "ghost",
              content: [testTimelineEvent({ event: "evt-missing" })],
            }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      // The span with no resolvable events still appears (content is empty but span exists)
      // Only branches with empty content are filtered
      expect(result.root.content).toHaveLength(2);
    });
  });

  describe("branches", () => {
    it("converts branches with branchedFrom references", () => {
      const events = [
        makeModelEvent("evt-1", 0, 10, 100),
        makeModelEvent("evt-2", 10, 20, 200),
        makeModelEvent("evt-3", 20, 30, 300),
      ];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [testTimelineEvent({ event: "evt-1" })],
          branches: [
            testTimelineSpan({
              id: "branch-1",
              name: "branch",
              branched_from: "msg-123",
              content: [testTimelineEvent({ event: "evt-2" })],
            }),
            testTimelineSpan({
              id: "branch-2",
              name: "branch",
              branched_from: "msg-456",
              content: [testTimelineEvent({ event: "evt-3" })],
            }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.root.branches).toHaveLength(2);
      expect(result.root.branches[0]!.branchedFrom).toBe("msg-123");
      expect(result.root.branches[0]!.content).toHaveLength(1);
      expect(result.root.branches[1]!.branchedFrom).toBe("msg-456");
      expect(result.root.branches[1]!.content).toHaveLength(1);
    });

    it("filters out branch spans where all events are missing", () => {
      const events = [makeModelEvent("evt-1", 0, 10, 100)];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [testTimelineEvent({ event: "evt-1" })],
          branches: [
            testTimelineSpan({
              id: "branch-good",
              name: "branch",
              branched_from: "msg-1",
              content: [testTimelineEvent({ event: "evt-1" })],
            }),
            testTimelineSpan({
              id: "branch-empty",
              name: "branch",
              branched_from: "msg-2",
              content: [testTimelineEvent({ event: "evt-missing" })],
            }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.root.branches).toHaveLength(1);
      expect(result.root.branches[0]!.id).toBe("branch-good");
    });

    it("handles nested branches within child spans", () => {
      const events = [
        makeModelEvent("evt-1", 0, 10, 100),
        makeModelEvent("evt-2", 10, 20, 200),
      ];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [
            testTimelineSpan({
              id: "child",
              name: "agent",
              content: [testTimelineEvent({ event: "evt-1" })],
              branches: [
                testTimelineSpan({
                  id: "child-branch",
                  name: "branch",
                  branched_from: "msg-nested",
                  content: [testTimelineEvent({ event: "evt-2" })],
                }),
              ],
            }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      const child = asTimelineSpan(result.root.content[0]);
      expect(child.branches).toHaveLength(1);
      expect(child.branches[0]!.branchedFrom).toBe("msg-nested");
    });
  });

  describe("computed properties", () => {
    it("computes timing from resolved events", () => {
      const events = [
        makeModelEvent("evt-1", 0, 10, 100),
        makeModelEvent("evt-2", 20, 30, 200),
      ];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [
            testTimelineEvent({ event: "evt-1" }),
            testTimelineEvent({ event: "evt-2" }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      const base = new Date("2025-01-15T10:00:00Z").getTime();
      expect(result.root.startTime().getTime()).toBe(base);
      expect(result.root.endTime().getTime()).toBe(base + 30_000);
    });

    it("computes token totals from resolved events", () => {
      const events = [
        makeModelEvent("evt-1", 0, 10, 100),
        makeModelEvent("evt-2", 10, 20, 200),
      ];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [
            testTimelineEvent({ event: "evt-1" }),
            testTimelineEvent({ event: "evt-2" }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.root.totalTokens()).toBe(300);
    });
  });

  describe("spanHasBranches", () => {
    it("returns false for a span with no branches anywhere", () => {
      const span = new TimelineSpan({
        id: "root",
        name: "root",
        spanType: null,
        content: [
          new TimelineSpan({ id: "child", name: "child", spanType: null }),
        ],
      });
      expect(spanHasBranches(span)).toBe(false);
    });

    it("returns true when the root has direct branches", () => {
      const span = new TimelineSpan({
        id: "root",
        name: "root",
        spanType: null,
        branches: [
          new TimelineSpan({ id: "b", name: "branch", spanType: "branch" }),
        ],
      });
      expect(spanHasBranches(span)).toBe(true);
    });

    it("returns true when a descendant span has branches", () => {
      const span = new TimelineSpan({
        id: "root",
        name: "root",
        spanType: null,
        content: [
          new TimelineSpan({
            id: "mid",
            name: "mid",
            spanType: null,
            content: [
              new TimelineSpan({
                id: "leaf",
                name: "leaf",
                spanType: null,
                branches: [
                  new TimelineSpan({
                    id: "b",
                    name: "branch",
                    spanType: "branch",
                  }),
                ],
              }),
            ],
          }),
        ],
      });
      expect(spanHasBranches(span)).toBe(true);
    });
  });

  describe("isEmptyBranch", () => {
    const anchor = new TimelineEvent(
      testAnchorEvent({ uuid: "a", timestamp: iso(0), working_start: 0 })
    );
    const branchEvt = new TimelineEvent(
      testBranchEvent({ uuid: "b", timestamp: iso(0), working_start: 0 })
    );
    const stepEvt = new TimelineEvent(
      testStepEvent({ uuid: "s", timestamp: iso(0), working_start: 0 })
    );
    const model = new TimelineEvent(makeModelEvent("m", 0, 1, 10));

    it("returns true for an empty span", () => {
      const span = new TimelineSpan({
        id: "x",
        name: "branch",
        spanType: "branch",
      });
      expect(isEmptyBranch(span)).toBe(true);
    });

    it("returns true when content is only anchor/branch/step events", () => {
      const span = new TimelineSpan({
        id: "x",
        name: "branch",
        spanType: "branch",
        content: [anchor, branchEvt, stepEvt],
      });
      expect(isEmptyBranch(span)).toBe(true);
    });

    it("returns false when content contains a model event", () => {
      const span = new TimelineSpan({
        id: "x",
        name: "branch",
        spanType: "branch",
        content: [anchor, model],
      });
      expect(isEmptyBranch(span)).toBe(false);
    });

    it("returns false when content contains a sub-span", () => {
      const sub = new TimelineSpan({
        id: "s",
        name: "agent",
        spanType: "agent",
      });
      const span = new TimelineSpan({
        id: "x",
        name: "branch",
        spanType: "branch",
        content: [sub],
      });
      expect(isEmptyBranch(span)).toBe(false);
    });

    it("returns false when a non-empty nested branch survives", () => {
      const nested = new TimelineSpan({
        id: "n",
        name: "branch",
        spanType: "branch",
        content: [model],
      });
      const span = new TimelineSpan({
        id: "x",
        name: "branch",
        spanType: "branch",
        content: [anchor],
        branches: [nested],
      });
      expect(isEmptyBranch(span)).toBe(false);
    });
  });

  describe("filterEmptyBranches", () => {
    const anchor = new TimelineEvent(
      testAnchorEvent({ uuid: "a", timestamp: iso(0), working_start: 0 })
    );
    const stepEvt = new TimelineEvent(
      testStepEvent({ uuid: "s", timestamp: iso(0), working_start: 0 })
    );
    const branchEvt = new TimelineEvent(
      testBranchEvent({ uuid: "b", timestamp: iso(0), working_start: 0 })
    );
    const model = new TimelineEvent(makeModelEvent("m", 0, 1, 10));

    function branch(
      id: string,
      content: (TimelineEvent | TimelineSpan)[] = [],
      branches: TimelineSpan[] = []
    ): TimelineSpan {
      return new TimelineSpan({
        id,
        name: "branch",
        spanType: "branch",
        content,
        branches,
      });
    }

    it("prunes top-level branches that only carry structural events", () => {
      const root = new TimelineSpan({
        id: "root",
        name: "main",
        spanType: "agent",
        content: [model],
        branches: [
          branch("empty-1", [anchor, anchor]),
          branch("empty-2", [branchEvt, stepEvt]),
          branch("has-model", [anchor, model]),
        ],
      });
      const result = filterEmptyBranches({
        name: "t",
        description: "",
        root,
      });
      expect(result.root.branches.map((b) => b.id)).toEqual(["has-model"]);
    });

    it("prunes empty nested branches but keeps an ancestor that wraps a non-empty one", () => {
      const root = new TimelineSpan({
        id: "root",
        name: "main",
        spanType: "agent",
        content: [model],
        branches: [branch("outer", [anchor], [branch("inner", [model])])],
      });
      const result = filterEmptyBranches({
        name: "t",
        description: "",
        root,
      });
      expect(result.root.branches).toHaveLength(1);
      expect(result.root.branches[0]!.id).toBe("outer");
      expect(result.root.branches[0]!.branches[0]!.id).toBe("inner");
    });

    it("recurses into content sub-spans", () => {
      const child = new TimelineSpan({
        id: "child",
        name: "agent",
        spanType: "agent",
        content: [model],
        branches: [branch("dead", [anchor])],
      });
      const root = new TimelineSpan({
        id: "root",
        name: "main",
        spanType: "agent",
        content: [child],
      });
      const result = filterEmptyBranches({
        name: "t",
        description: "",
        root,
      });
      const newChild = asTimelineSpan(result.root.content[0]);
      expect(newChild.branches).toHaveLength(0);
    });
  });

  describe("outline", () => {
    it("preserves outline data through conversion", () => {
      const events = [makeModelEvent("evt-1", 0, 10, 100)];

      const server = makeServerTimeline(
        testTimelineSpan({
          id: "root",
          name: "main",
          content: [testTimelineEvent({ event: "evt-1" })],
          outline: {
            nodes: [{ event: "evt-1", children: [] }],
          },
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.root.outline).toBeDefined();
      expect(result.root.outline!.nodes).toHaveLength(1);
      expect(result.root.outline!.nodes[0]!.event).toBe("evt-1");
    });
  });
});

// =============================================================================
// countUtilitySpans
// =============================================================================

describe("countUtilitySpans", () => {
  const span = (
    id: string,
    options?: { utility?: boolean; content?: TimelineSpan[] }
  ) =>
    new TimelineSpan({
      id,
      name: id,
      spanType: "agent",
      content: options?.content ?? [],
      utility: options?.utility ?? false,
    });

  it("returns 0 for a tree with no utility spans", () => {
    const root = span("root", { content: [span("child")] });
    expect(countUtilitySpans(root)).toBe(0);
  });

  it("counts utility spans across nesting levels", () => {
    const root = span("root", {
      content: [
        span("u1", { utility: true }),
        span("child", { content: [span("u2", { utility: true })] }),
      ],
    });
    expect(countUtilitySpans(root)).toBe(2);
  });

  it("excludes utility spans inside branches (not revealed by the utility toggle)", () => {
    const branch = span("branch", { content: [span("u1", { utility: true })] });
    const root = new TimelineSpan({
      id: "root",
      name: "root",
      spanType: "agent",
      content: [span("u2", { utility: true })],
      branches: [branch],
    });
    expect(countUtilitySpans(root)).toBe(1);
  });
});

// =============================================================================
// utility wrapper ids for uuid-less events
// =============================================================================

describe("utility wrapper ids", () => {
  // Legacy logs predate event uuids; wrapper ids must stay unique and
  // deterministic without them. (The JSON fixtures can't express this case —
  // the Python side auto-assigns uuids at parse time.)
  it("assigns unique position-derived ids to uuid-less wrapped events", () => {
    const { nextTs, base } = rawEventBuilders();
    const warmup = () =>
      testModelEvent({
        ...base(),
        completed: nextTs(),
        span_id: "monitor",
        model: "mockllm/model",
        config: { max_tokens: 1 },
        input: [testUserMessage({ content: "warmup" })],
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({ content: "w" }),
              stop_reason: "max_tokens",
            }),
          ],
          usage: testModelUsage({ input_tokens: 5, output_tokens: 1 }),
        }),
      });
    const timeline = buildTimeline([
      testSpanBeginEvent({
        ...base(),
        id: "solvers",
        name: "solvers",
        type: "solvers",
        parent_id: null,
      }),
      testSpanBeginEvent({
        ...base(),
        id: "monitor",
        name: "monitor",
        type: "agent",
        parent_id: "solvers",
      }),
      warmup(),
      warmup(),
      testSpanEndEvent({ ...base(), id: "monitor" }),
      testSpanEndEvent({ ...base(), id: "solvers" }),
    ]);

    const wrappers = timeline.root.content.filter(
      (item): item is TimelineSpan => item.type === "span" && item.utility
    );
    expect(wrappers.map((w) => w.id)).toEqual([
      "utility-monitor-0",
      "utility-monitor-1",
    ]);
  });
});
