import { describe, expect, it } from "vitest";

import { EventNode, type EventType } from "../types";

import { collectAllCollapsibleIds, computeDefaultCollapsedIds } from "./collapse";

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
// computeDefaultCollapsedIds
// =============================================================================

describe("computeDefaultCollapsedIds", () => {
  it("collapses successful non-agent tool events", () => {
    const tool = node({ event: "tool", agent: null, failed: null });
    expect(computeDefaultCollapsedIds([tool])).toEqual({ [tool.id]: true });
  });

  it("does not collapse agent or failed tool events", () => {
    const agentTool = node({ event: "tool", agent: "handoff", failed: null });
    const failedTool = node({ event: "tool", agent: null, failed: true });
    expect(computeDefaultCollapsedIds([agentTool, failedTool])).toEqual({});
  });

  it("collapses init/sample_init spans and system_message solver steps", () => {
    const init = node({ event: "span_begin", name: "init", type: null });
    const sysMsg = node({
      event: "step",
      type: "solver",
      name: "system_message",
    });
    expect(computeDefaultCollapsedIds([init, sysMsg])).toEqual({
      [init.id]: true,
      [sysMsg.id]: true,
    });
  });

  it("collapses subtasks and traverses children", () => {
    const subtask = node({ event: "subtask" });
    const span = node(
      { event: "span_begin", name: "agent", type: "agent" },
      [subtask]
    );
    expect(computeDefaultCollapsedIds([span])).toEqual({
      [subtask.id]: true,
    });
  });

  it("ignores non-collapsible events", () => {
    const model = node({ event: "model" });
    const info = node({ event: "info" });
    expect(computeDefaultCollapsedIds([model, info])).toEqual({});
  });
});

// =============================================================================
// collectAllCollapsibleIds
// =============================================================================

describe("collectAllCollapsibleIds", () => {
  it("collects tree-collapsible and content-collapsible nodes recursively", () => {
    const model = node({ event: "model" });
    const state = node({ event: "state" });
    const info = node({ event: "info" });
    const tool = node({ event: "tool" }, [model]);
    const span = node({ event: "span_begin", name: "s", type: null }, [
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
