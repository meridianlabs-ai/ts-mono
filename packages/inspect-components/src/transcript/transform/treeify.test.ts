import { describe, expect, it } from "vitest";

import { EventNode, type EventType } from "../types";

import { filterEmptySpans } from "./treeify";

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

// =============================================================================
// filterEmptySpans
// =============================================================================

describe("filterEmptySpans", () => {
  it("removes childless span and step nodes", () => {
    const span = node({ event: "span_begin", name: "s", type: null });
    const step = node({ event: "step", name: "s", type: null });
    expect(filterEmptySpans([span, step])).toEqual([]);
  });

  it("keeps spans with children and leaf events", () => {
    const model = node({ event: "model" });
    const span = node({ event: "span_begin", name: "s", type: null }, [model]);
    const info = node({ event: "info" });
    expect(filterEmptySpans([span, info])).toEqual([span, info]);
  });

  it("removes spans whose only children are empty spans", () => {
    const inner = node({ event: "span_begin", name: "inner", type: null });
    const outer = node({ event: "span_begin", name: "outer", type: null }, [
      inner,
    ]);
    expect(filterEmptySpans([outer])).toEqual([]);
  });

  it("keeps childless fork_nav and empty_branch spans", () => {
    const forkNav = node({
      event: "span_begin",
      name: "f",
      type: "fork_nav",
    });
    const emptyBranch = node({
      event: "span_begin",
      name: "b",
      type: "empty_branch",
    });
    expect(filterEmptySpans([forkNav, emptyBranch])).toEqual([
      forkNav,
      emptyBranch,
    ]);
  });

  it("keeps childless spans with an attached sourceSpan (agent cards)", () => {
    const card = node({ event: "span_begin", name: "agent", type: "agent" });
    card.sourceSpan = { spanType: "agent", name: "agent" };
    expect(filterEmptySpans([card])).toEqual([card]);
  });
});
