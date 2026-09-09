import { describe, expect, it } from "vitest";

import {
  testInfoEvent,
  testModelEvent,
  testSpanBeginEvent,
  testStateEvent,
  testStepEvent,
  testSubtaskEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";

import { eventNode } from "../testHelpers";

import {
  collectAllCollapsibleIds,
  computeDefaultCollapsedIds,
} from "./collapse";
import { kSandboxSignalName } from "./fixups";

// =============================================================================
// computeDefaultCollapsedIds
// =============================================================================

describe("computeDefaultCollapsedIds", () => {
  it.each([
    {
      desc: "successful non-agent tool",
      event: testToolEvent({ agent: null, failed: null }),
      collapsed: true,
    },
    {
      desc: "agent tool",
      event: testToolEvent({ agent: "handoff", failed: null }),
      collapsed: false,
    },
    {
      desc: "failed tool",
      event: testToolEvent({ agent: null, failed: true }),
      collapsed: false,
    },
    {
      desc: "init span",
      event: testSpanBeginEvent({ name: "init", type: null }),
      collapsed: true,
    },
    {
      desc: "sample_init span",
      event: testSpanBeginEvent({ name: "sample_init", type: null }),
      collapsed: true,
    },
    {
      desc: "sandbox-signal span",
      event: testSpanBeginEvent({ name: kSandboxSignalName, type: null }),
      collapsed: true,
    },
    {
      desc: "system_message solver step",
      event: testStepEvent({ type: "solver", name: "system_message" }),
      collapsed: true,
    },
    {
      desc: "subtask",
      event: testSubtaskEvent(),
      collapsed: true,
    },
    {
      desc: "model event",
      event: testModelEvent(),
      collapsed: false,
    },
    {
      desc: "info event",
      event: testInfoEvent(),
      collapsed: false,
    },
    {
      desc: "plain agent span",
      event: testSpanBeginEvent({ name: "agent", type: "agent" }),
      collapsed: false,
    },
  ] as const)(
    "$desc → collapsed by default: $collapsed",
    ({ event, collapsed }) => {
      const node = eventNode(event);
      expect(computeDefaultCollapsedIds([node])).toEqual(
        collapsed ? { [node.id]: true } : {}
      );
    }
  );

  it("traverses children", () => {
    const subtask = eventNode(testSubtaskEvent());
    const span = eventNode(
      testSpanBeginEvent({ name: "agent", type: "agent" }),
      [subtask]
    );
    expect(computeDefaultCollapsedIds([span])).toEqual({
      [subtask.id]: true,
    });
  });
});

// =============================================================================
// collectAllCollapsibleIds
// =============================================================================

describe("collectAllCollapsibleIds", () => {
  it("collects tree-collapsible and content-collapsible nodes recursively", () => {
    const model = eventNode(testModelEvent());
    const state = eventNode(testStateEvent());
    const info = eventNode(testInfoEvent());
    const tool = eventNode(testToolEvent(), [model]);
    const span = eventNode(testSpanBeginEvent({ name: "s", type: null }), [
      tool,
      state,
      info,
    ]);

    expect(collectAllCollapsibleIds([span])).toEqual({
      [span.id]: true,
      [tool.id]: true,
      [model.id]: true,
      [state.id]: true,
    });
  });
});
