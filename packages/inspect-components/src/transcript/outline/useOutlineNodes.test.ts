import { describe, expect, it } from "vitest";

import { EventNode, type EventType } from "../types";

import { buildOutlineNodeList } from "./useOutlineNodes";

// =============================================================================
// Fixtures
// =============================================================================

let nextId = 0;

function node(
  event: Partial<EventType> & { event: string },
  children: EventNode[] = []
): EventNode {
  const n = new EventNode(`n${nextId++}`, event as EventType, 0);
  n.children = children;
  return n;
}

function modelNode(): EventNode {
  return node({
    event: "model",
    timestamp: "2024-01-01T00:00:00Z",
    working_start: 0,
    span_id: null,
  });
}

// =============================================================================
// buildOutlineNodeList
// =============================================================================

describe("buildOutlineNodeList", () => {
  it("removes non-outline event types", () => {
    const nodes = [
      node({ event: "logger" }),
      node({ event: "info" }),
      node({ event: "state" }),
      node({ event: "store" }),
      node({ event: "error" }),
    ];
    const result = buildOutlineNodeList(nodes, {});
    expect(result.map((n) => n.event.event)).toEqual(["error"]);
  });

  it("groups a model/tool run into a collapsed turns row", () => {
    const nodes = [modelNode(), node({ event: "tool" })];
    const result = buildOutlineNodeList(nodes, {});
    expect(result).toHaveLength(1);
    const turns = result[0]!;
    expect(turns.event.event).toBe("span_begin");
    expect((turns.event as { type?: string }).type).toBe("turns");
    expect((turns.event as { name?: string }).name).toBe("1 turn");
  });

  it("counts consecutive turns", () => {
    const nodes = [modelNode(), modelNode(), modelNode()];
    const result = buildOutlineNodeList(nodes, {});
    expect(result).toHaveLength(1);
    expect((result[0]!.event as { name?: string }).name).toBe("3 turns");
  });

  it("collapses consecutive score events into a scoring row", () => {
    const nodes = [
      node({ event: "score" }),
      node({ event: "score" }),
      node({ event: "error" }),
    ];
    const result = buildOutlineNodeList(nodes, {});
    expect(result.map((n) => (n.event as { name?: string }).name)).toEqual([
      "scoring",
      undefined,
    ]);
  });

  it("does not descend into collapsed nodes", () => {
    const span = node({ event: "span_begin", name: "agent", type: "agent" }, [
      modelNode(),
    ]);
    const expanded = buildOutlineNodeList([span], {});
    expect(expanded.map((n) => (n.event as { type?: string }).type)).toEqual([
      "agent",
      "turns",
    ]);

    const collapsed = buildOutlineNodeList([span], { [span.id]: true });
    expect(collapsed.map((n) => (n.event as { type?: string }).type)).toEqual([
      "agent",
    ]);
  });
});
