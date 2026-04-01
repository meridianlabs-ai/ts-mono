import { describe, expect, it } from "vitest";

import type { EventType } from "../types";
import { EventNode } from "../types";

import { collapseScoring, collapseTurns, makeTurns } from "./tree-visitors";

// =============================================================================
// Helpers
// =============================================================================

/** Minimal event stub — tree-visitors only inspect `event.event` and a few
 *  metadata fields (`working_start`, `timestamp`, `span_id`). We satisfy
 *  the type system with a cast at this one boundary so every test can use
 *  concise factory functions. */
function evt(type: string, overrides?: Record<string, unknown>): EventType {
  return {
    event: type,
    working_start: 0,
    timestamp: "2025-01-01T00:00:00Z",
    span_id: null,
    pending: false,
    uuid: null,
    metadata: null,
    ...overrides,
  } as unknown as EventType;
}

function node(type: string, id?: string, depth = 0): EventNode {
  return new EventNode(id ?? type, evt(type), depth);
}

function ids(nodes: EventNode[]): string[] {
  return nodes.map((n) => n.id);
}

function childIds(n: EventNode): string[] {
  return n.children.map((c) => c.id);
}

// =============================================================================
// makeTurns
// =============================================================================

describe("makeTurns", () => {
  it("wraps model + tools into a single turn", () => {
    const nodes = [node("model", "m1"), node("tool", "t1"), node("tool", "t2")];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(1);
    expect(result[0]!.event.event).toBe("span_begin");
    expect((result[0]!.event as { type: string }).type).toBe("turn");
    expect((result[0]!.event as { name: string }).name).toBe("turn 1");
    expect(childIds(result[0]!)).toEqual(["m1", "t1", "t2"]);
  });

  it("creates separate turns for back-to-back model events", () => {
    const nodes = [
      node("model", "m1"),
      node("model", "m2"),
      node("tool", "t1"),
    ];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(2);
    expect((result[0]!.event as { name: string }).name).toBe("turn 1");
    expect(childIds(result[0]!)).toEqual(["m1"]);
    expect((result[1]!.event as { name: string }).name).toBe("turn 2");
    expect(childIds(result[1]!)).toEqual(["m2", "t1"]);
  });

  it("emits a turn for a lone model event (no tools)", () => {
    const nodes = [node("model", "m1")];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(1);
    expect((result[0]!.event as { name: string }).name).toBe("turn 1");
    expect(childIds(result[0]!)).toEqual(["m1"]);
  });

  it("passes through non-turn events unchanged", () => {
    const nodes = [
      node("span_begin", "sb1"),
      node("model", "m1"),
      node("tool", "t1"),
      node("score", "s1"),
    ];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe("sb1");
    expect(result[0]!.event.event).toBe("span_begin");
    expect((result[1]!.event as { name: string }).name).toBe("turn 1");
    expect(result[2]!.id).toBe("s1");
    expect(result[2]!.event.event).toBe("score");
  });

  it("creates multiple turns for alternating model/tool pairs", () => {
    const nodes = [
      node("model", "m1"),
      node("tool", "t1"),
      node("model", "m2"),
      node("tool", "t2"),
    ];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(2);
    expect(childIds(result[0]!)).toEqual(["m1", "t1"]);
    expect(childIds(result[1]!)).toEqual(["m2", "t2"]);
  });

  it("emits trailing model without tools as a turn", () => {
    const nodes = [
      node("model", "m1"),
      node("tool", "t1"),
      node("model", "m2"),
    ];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(2);
    expect(childIds(result[0]!)).toEqual(["m1", "t1"]);
    expect((result[1]!.event as { name: string }).name).toBe("turn 2");
    expect(childIds(result[1]!)).toEqual(["m2"]);
  });

  it("handles three consecutive model events", () => {
    const nodes = [
      node("model", "m1"),
      node("model", "m2"),
      node("model", "m3"),
      node("tool", "t1"),
    ];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(3);
    expect(childIds(result[0]!)).toEqual(["m1"]);
    expect(childIds(result[1]!)).toEqual(["m2"]);
    expect(childIds(result[2]!)).toEqual(["m3", "t1"]);
  });

  it("handles five consecutive model events", () => {
    const nodes = [
      node("model", "m1"),
      node("model", "m2"),
      node("model", "m3"),
      node("model", "m4"),
      node("model", "m5"),
    ];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect((result[i]!.event as { name: string }).name).toBe(`turn ${i + 1}`);
      expect(childIds(result[i]!)).toEqual([`m${i + 1}`]);
    }
  });

  it("flushes pending model-only turn before a non-turn event", () => {
    const nodes = [node("model", "m1"), node("span_begin", "sb1")];
    const result = makeTurns(nodes);

    expect(result).toHaveLength(2);
    expect((result[0]!.event as { name: string }).name).toBe("turn 1");
    expect(childIds(result[0]!)).toEqual(["m1"]);
    expect(result[1]!.id).toBe("sb1");
  });

  it("returns empty array for empty input", () => {
    expect(makeTurns([])).toEqual([]);
  });

  it("returns non-turn events as-is when no model events exist", () => {
    const nodes = [node("span_begin", "sb1"), node("score", "s1")];
    const result = makeTurns(nodes);
    expect(ids(result)).toEqual(["sb1", "s1"]);
  });
});

// =============================================================================
// collapseTurns
// =============================================================================

describe("collapseTurns", () => {
  /** Create a synthetic turn node matching what makeTurns produces. */
  function turnNode(id: string, depth = 0): EventNode {
    return new EventNode(
      id,
      evt("span_begin", { type: "turn", name: `turn ${id}` }),
      depth
    );
  }

  it("collapses consecutive turns into a single 'N turns' node", () => {
    const nodes = [turnNode("t1"), turnNode("t2"), turnNode("t3")];
    const result = collapseTurns(nodes);

    expect(result).toHaveLength(1);
    expect((result[0]!.event as { name: string }).name).toBe("3 turns");
    expect((result[0]!.event as { type: string }).type).toBe("turns");
  });

  it("labels a single turn as '1 turn'", () => {
    const nodes = [turnNode("t1")];
    const result = collapseTurns(nodes);

    expect(result).toHaveLength(1);
    expect((result[0]!.event as { name: string }).name).toBe("1 turn");
  });

  it("splits groups when a non-turn event appears", () => {
    const nodes = [
      turnNode("t1"),
      turnNode("t2"),
      node("score", "s1"),
      turnNode("t3"),
    ];
    const result = collapseTurns(nodes);

    expect(result).toHaveLength(3);
    expect((result[0]!.event as { name: string }).name).toBe("2 turns");
    expect(result[1]!.id).toBe("s1");
    expect((result[2]!.event as { name: string }).name).toBe("1 turn");
  });

  it("splits groups at different depths", () => {
    const shallow = turnNode("t1", 0);
    const deep = turnNode("t2", 1);
    const result = collapseTurns([shallow, deep]);

    expect(result).toHaveLength(2);
    expect((result[0]!.event as { name: string }).name).toBe("1 turn");
    expect((result[1]!.event as { name: string }).name).toBe("1 turn");
  });

  it("passes through non-turn events unchanged", () => {
    const nodes = [node("span_begin", "sb1"), node("score", "s1")];
    const result = collapseTurns(nodes);
    expect(ids(result)).toEqual(["sb1", "s1"]);
  });
});

// =============================================================================
// collapseScoring
// =============================================================================

describe("collapseScoring", () => {
  it("collapses consecutive score events into a single 'scoring' node", () => {
    const nodes = [node("score", "s1"), node("score", "s2")];
    const result = collapseScoring(nodes);

    expect(result).toHaveLength(1);
    expect((result[0]!.event as { name: string }).name).toBe("scoring");
    expect((result[0]!.event as { type: string }).type).toBe("scorings");
  });

  it("splits groups when a non-score event appears", () => {
    const nodes = [
      node("score", "s1"),
      node("model", "m1"),
      node("score", "s2"),
    ];
    const result = collapseScoring(nodes);

    expect(result).toHaveLength(3);
    expect((result[0]!.event as { name: string }).name).toBe("scoring");
    expect(result[1]!.id).toBe("m1");
    expect((result[2]!.event as { name: string }).name).toBe("scoring");
  });

  it("passes through non-score events unchanged", () => {
    const nodes = [node("model", "m1"), node("tool", "t1")];
    const result = collapseScoring(nodes);
    expect(ids(result)).toEqual(["m1", "t1"]);
  });
});

// =============================================================================
// Full pipeline: makeTurns → collapseTurns → collapseScoring
// =============================================================================

describe("full pipeline", () => {
  it("processes a typical agent transcript", () => {
    const nodes = [
      node("span_begin", "agent"),
      node("model", "m1"),
      node("tool", "t1"),
      node("tool", "t2"),
      node("model", "m2"),
      node("tool", "t3"),
      node("model", "m3"),
      node("tool", "t4"),
      node("score", "s1"),
      node("score", "s2"),
    ];

    const result = collapseScoring(collapseTurns(makeTurns(nodes)));

    // agent span + collapsed turns + collapsed scoring
    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe("agent");
    expect((result[1]!.event as { name: string }).name).toBe("3 turns");
    expect((result[2]!.event as { name: string }).name).toBe("scoring");
  });

  it("handles back-to-back models in the full pipeline", () => {
    const nodes = [
      node("model", "m1"),
      node("model", "m2"),
      node("model", "m3"),
      node("tool", "t1"),
      node("score", "s1"),
    ];

    const result = collapseScoring(collapseTurns(makeTurns(nodes)));

    // 3 turns (collapsed) + scoring
    expect(result).toHaveLength(2);
    expect((result[0]!.event as { name: string }).name).toBe("3 turns");
    expect((result[1]!.event as { name: string }).name).toBe("scoring");
  });
});
