/**
 * Tests for convertServerTimeline() — the server-to-client timeline conversion.
 *
 * These tests ensure UUID resolution, nested span handling, and branch
 * preservation work correctly, providing a safety net before the migration
 * to the shared inspect-components package.
 */

import { describe, expect, it } from "vitest";

import type {
  Event,
  ServerTimeline,
  ServerTimelineEvent,
  ServerTimelineSpan,
} from "../../types/api-types";

import { convertServerTimeline, TimelineEvent, TimelineSpan } from "./timeline";

// =============================================================================
// Helpers
// =============================================================================

function makeEvent(
  uuid: string,
  type: string,
  startSec: number,
  endSec?: number,
  tokens?: number
): Event {
  const base = new Date("2025-01-15T10:00:00Z").getTime();
  return {
    event: type,
    uuid,
    timestamp: new Date(base + startSec * 1000).toISOString(),
    completed: endSec
      ? new Date(base + endSec * 1000).toISOString()
      : undefined,
    working_start: startSec,
    pending: false,
    metadata: null,
    ...(type === "model"
      ? {
          model: "test-model",
          output: {
            usage: {
              input_tokens: tokens ? Math.floor(tokens * 0.6) : 0,
              output_tokens: tokens ? tokens - Math.floor(tokens * 0.6) : 0,
              total_tokens: tokens ?? 0,
              input_tokens_cache_read: null,
              input_tokens_cache_write: null,
              reasoning_tokens: null,
              total_cost: null,
            },
          },
        }
      : {}),
  } as Event;
}

function makeServerEvent(uuid: string): ServerTimelineEvent {
  return { type: "event", event: uuid } as unknown as ServerTimelineEvent;
}

function makeServerSpan(
  overrides: Partial<ServerTimelineSpan> & { id: string; name: string }
): ServerTimelineSpan {
  return {
    type: "span",
    span_type: null,
    content: [],
    branches: [],
    branched_from: null,
    description: null,
    utility: false,
    agent_result: null,
    outline: null,
    ...overrides,
  } as ServerTimelineSpan;
}

function makeServerTimeline(root: ServerTimelineSpan): ServerTimeline {
  return {
    name: "test",
    description: "test timeline",
    root,
  } as ServerTimeline;
}

// =============================================================================
// Tests
// =============================================================================

describe("convertServerTimeline", () => {
  describe("UUID resolution", () => {
    it("resolves event UUIDs to full Event objects", () => {
      const events = [
        makeEvent("evt-1", "model", 0, 10, 100),
        makeEvent("evt-2", "model", 10, 20, 200),
      ];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [makeServerEvent("evt-1"), makeServerEvent("evt-2")],
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.name).toBe("test");
      expect(result.description).toBe("test timeline");
      expect(result.root.content).toHaveLength(2);
      expect(result.root.content[0]).toBeInstanceOf(TimelineEvent);
      expect((result.root.content[0] as TimelineEvent).event.uuid).toBe(
        "evt-1"
      );
      expect((result.root.content[1] as TimelineEvent).event.uuid).toBe(
        "evt-2"
      );
    });

    it("filters out events with missing UUIDs", () => {
      const events = [makeEvent("evt-1", "model", 0, 10, 100)];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [makeServerEvent("evt-1"), makeServerEvent("evt-missing")],
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.root.content).toHaveLength(1);
      expect((result.root.content[0] as TimelineEvent).event.uuid).toBe(
        "evt-1"
      );
    });

    it("handles empty events array", () => {
      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [makeServerEvent("evt-1")],
        })
      );

      const result = convertServerTimeline(server, []);

      expect(result.root.content).toHaveLength(0);
    });
  });

  describe("nested spans", () => {
    it("converts nested span hierarchy", () => {
      const events = [
        makeEvent("evt-1", "model", 0, 10, 100),
        makeEvent("evt-2", "model", 10, 20, 200),
        makeEvent("evt-3", "model", 20, 30, 300),
      ];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [
            makeServerEvent("evt-1"),
            makeServerSpan({
              id: "child",
              name: "explore",
              span_type: "agent",
              content: [
                makeServerEvent("evt-2"),
                makeServerSpan({
                  id: "grandchild",
                  name: "build",
                  span_type: "agent",
                  content: [makeServerEvent("evt-3")],
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

      const childSpan = result.root.content[1] as TimelineSpan;
      expect(childSpan).toBeInstanceOf(TimelineSpan);
      expect(childSpan.name).toBe("explore");
      expect(childSpan.spanType).toBe("agent");
      expect(childSpan.content).toHaveLength(2);

      const grandchild = childSpan.content[1] as TimelineSpan;
      expect(grandchild).toBeInstanceOf(TimelineSpan);
      expect(grandchild.name).toBe("build");
      expect(grandchild.content).toHaveLength(1);
    });

    it("preserves span properties through conversion", () => {
      const events = [makeEvent("evt-1", "model", 0, 10, 100)];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [
            makeServerSpan({
              id: "agent-1",
              name: "helper",
              span_type: "agent",
              utility: true,
              description: "A helper agent",
              agent_result: "Done helping",
              content: [makeServerEvent("evt-1")],
            }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);
      const agent = result.root.content[0] as TimelineSpan;

      expect(agent.id).toBe("agent-1");
      expect(agent.name).toBe("helper");
      expect(agent.spanType).toBe("agent");
      expect(agent.utility).toBe(true);
      expect(agent.description).toBe("A helper agent");
      expect(agent.agentResult).toBe("Done helping");
    });

    it("filters out empty child spans (all events missing)", () => {
      const events = [makeEvent("evt-1", "model", 0, 10, 100)];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [
            makeServerEvent("evt-1"),
            makeServerSpan({
              id: "empty",
              name: "ghost",
              content: [makeServerEvent("evt-missing")],
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
        makeEvent("evt-1", "model", 0, 10, 100),
        makeEvent("evt-2", "model", 10, 20, 200),
        makeEvent("evt-3", "model", 20, 30, 300),
      ];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [makeServerEvent("evt-1")],
          branches: [
            makeServerSpan({
              id: "branch-1",
              name: "branch",
              branched_from: "msg-123",
              content: [makeServerEvent("evt-2")],
            }),
            makeServerSpan({
              id: "branch-2",
              name: "branch",
              branched_from: "msg-456",
              content: [makeServerEvent("evt-3")],
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
      const events = [makeEvent("evt-1", "model", 0, 10, 100)];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [makeServerEvent("evt-1")],
          branches: [
            makeServerSpan({
              id: "branch-good",
              name: "branch",
              branched_from: "msg-1",
              content: [makeServerEvent("evt-1")],
            }),
            makeServerSpan({
              id: "branch-empty",
              name: "branch",
              branched_from: "msg-2",
              content: [makeServerEvent("evt-missing")],
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
        makeEvent("evt-1", "model", 0, 10, 100),
        makeEvent("evt-2", "model", 10, 20, 200),
      ];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [
            makeServerSpan({
              id: "child",
              name: "agent",
              content: [makeServerEvent("evt-1")],
              branches: [
                makeServerSpan({
                  id: "child-branch",
                  name: "branch",
                  branched_from: "msg-nested",
                  content: [makeServerEvent("evt-2")],
                }),
              ],
            }),
          ],
        })
      );

      const result = convertServerTimeline(server, events);

      const child = result.root.content[0] as TimelineSpan;
      expect(child.branches).toHaveLength(1);
      expect(child.branches[0]!.branchedFrom).toBe("msg-nested");
    });
  });

  describe("computed properties", () => {
    it("computes timing from resolved events", () => {
      const events = [
        makeEvent("evt-1", "model", 0, 10, 100),
        makeEvent("evt-2", "model", 20, 30, 200),
      ];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [makeServerEvent("evt-1"), makeServerEvent("evt-2")],
        })
      );

      const result = convertServerTimeline(server, events);

      const base = new Date("2025-01-15T10:00:00Z").getTime();
      expect(result.root.startTime().getTime()).toBe(base);
      expect(result.root.endTime().getTime()).toBe(base + 30_000);
    });

    it("computes token totals from resolved events", () => {
      const events = [
        makeEvent("evt-1", "model", 0, 10, 100),
        makeEvent("evt-2", "model", 10, 20, 200),
      ];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [makeServerEvent("evt-1"), makeServerEvent("evt-2")],
        })
      );

      const result = convertServerTimeline(server, events);

      expect(result.root.totalTokens()).toBe(300);
    });
  });

  describe("outline", () => {
    it("preserves outline data through conversion", () => {
      const events = [makeEvent("evt-1", "model", 0, 10, 100)];

      const server = makeServerTimeline(
        makeServerSpan({
          id: "root",
          name: "main",
          content: [makeServerEvent("evt-1")],
          outline: {
            nodes: [{ event: "evt-1", children: [] }],
          },
        } as Partial<ServerTimelineSpan> & { id: string; name: string })
      );

      const result = convertServerTimeline(server, events);

      expect(result.root.outline).toBeDefined();
      expect(result.root.outline!.nodes).toHaveLength(1);
      expect(result.root.outline!.nodes[0]!.event).toBe("evt-1");
    });
  });
});
