import { describe, expect, it } from "vitest";

import {
  testInfoEvent,
  testModelEvent,
  testSpanBeginEvent,
  testStepEvent,
} from "@tsmono/inspect-common/testing";

import { eventNode } from "../testHelpers";

import { filterEmptySpans } from "./treeify";

// =============================================================================
// filterEmptySpans
// =============================================================================

describe("filterEmptySpans", () => {
  it.each([
    {
      desc: "childless span",
      event: testSpanBeginEvent({ name: "s", type: null }),
      kept: false,
    },
    {
      desc: "childless step",
      event: testStepEvent({ name: "s", type: null }),
      kept: false,
    },
    {
      desc: "childless fork_nav span",
      event: testSpanBeginEvent({ name: "f", type: "fork_nav" }),
      kept: true,
    },
    {
      desc: "childless empty_branch span",
      event: testSpanBeginEvent({ name: "b", type: "empty_branch" }),
      kept: true,
    },
    {
      desc: "model leaf",
      event: testModelEvent(),
      kept: true,
    },
    {
      desc: "info leaf",
      event: testInfoEvent(),
      kept: true,
    },
  ] as const)("$desc → kept: $kept", ({ event, kept }) => {
    const node = eventNode(event);
    expect(filterEmptySpans([node])).toEqual(kept ? [node] : []);
  });

  it("keeps spans with children", () => {
    const model = eventNode(testModelEvent());
    const span = eventNode(testSpanBeginEvent({ name: "s", type: null }), [
      model,
    ]);
    expect(filterEmptySpans([span])).toEqual([span]);
  });

  it("removes spans whose only children are empty spans", () => {
    const inner = eventNode(testSpanBeginEvent({ name: "inner", type: null }));
    const outer = eventNode(testSpanBeginEvent({ name: "outer", type: null }), [
      inner,
    ]);
    expect(filterEmptySpans([outer])).toEqual([]);
  });

  it("keeps childless spans with an attached sourceSpan (agent cards)", () => {
    const card = eventNode(
      testSpanBeginEvent({ name: "agent", type: "agent" })
    );
    card.sourceSpan = { spanType: "agent", name: "agent" };
    expect(filterEmptySpans([card])).toEqual([card]);
  });
});
