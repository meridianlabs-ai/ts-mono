// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  testApprovalEvent,
  testErrorEvent,
  testInfoEvent,
  testInputEvent,
  testLoggerEvent,
  testModelEvent,
  testSandboxEvent,
  testScoreEvent,
  testSpanBeginEvent,
  testStateEvent,
  testStoreEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import { isRecord } from "@tsmono/util";

import { eventNode } from "../testHelpers";
import { kSandboxSignalName } from "../transform/fixups";
import { EventNode, EventType } from "../types";

import { buildOutlineNodeList, useOutlineNodes } from "./useOutlineNodes";

// =============================================================================
// Fixtures
// =============================================================================

// The outline drops these event types; one real builder each, so the cases
// are driven by the same list they assert on.
const kRemovedEventBuilders = {
  logger: testLoggerEvent,
  info: testInfoEvent,
  state: testStateEvent,
  store: testStoreEvent,
  approval: testApprovalEvent,
  input: testInputEvent,
  sandbox: testSandboxEvent,
} satisfies Partial<Record<EventType["event"], () => EventType>>;

function modelNode(): EventNode {
  return eventNode(
    testModelEvent({
      timestamp: "2024-01-01T00:00:00Z",
      working_start: 0,
      span_id: null,
    })
  );
}

// =============================================================================
// buildOutlineNodeList
// =============================================================================

// makeTurns rewrites `name`/`type` on the event it collapses; these read them
// back without claiming every member of the union carries them.
const readStringField = (node: EventNode, key: string): string | undefined => {
  const event: unknown = node.event;
  if (!isRecord(event)) return undefined;
  const value = event[key];
  return typeof value === "string" ? value : undefined;
};

describe("buildOutlineNodeList", () => {
  const removedEventTypes = [
    "logger",
    "info",
    "state",
    "store",
    "approval",
    "input",
    "sandbox",
  ] as const satisfies (keyof typeof kRemovedEventBuilders)[];
  it.each(removedEventTypes)("removes %s events", (eventType) => {
    const nodes = [
      eventNode(kRemovedEventBuilders[eventType]()),
      eventNode(testErrorEvent()),
    ];
    expect(buildOutlineNodeList(nodes, {}).map((n) => n.event.event)).toEqual([
      "error",
    ]);
  });

  it("removes step/span nodes named with the sandbox signal", () => {
    const nodes = [
      eventNode(testSpanBeginEvent({ name: kSandboxSignalName, type: null })),
      eventNode(testErrorEvent()),
    ];
    expect(buildOutlineNodeList(nodes, {}).map((n) => n.event.event)).toEqual([
      "error",
    ]);
  });

  it("removes the children of scorer spans", () => {
    const scoreChild = eventNode(testScoreEvent(), [], 2);
    const scorer = eventNode(
      testSpanBeginEvent({ name: "grader", type: "scorer" }),
      [scoreChild],
      1
    );
    const scorers = eventNode(
      testSpanBeginEvent({ name: "scorers", type: "scorers" }),
      [scorer],
      0
    );
    const result = buildOutlineNodeList([scorers], {});
    expect(result.map((n) => readStringField(n, "type"))).toEqual([
      "scorers",
      "scorer",
    ]);
  });

  it("groups a model/tool run into a collapsed turns row", () => {
    const nodes = [modelNode(), eventNode(testToolEvent())];
    const result = buildOutlineNodeList(nodes, {});
    expect(result).toHaveLength(1);
    const turns = result[0]!;
    expect(turns.event.event).toBe("span_begin");
    expect(readStringField(turns, "type")).toBe("turns");
    expect(readStringField(turns, "name")).toBe("1 turn");
  });

  it("counts consecutive turns", () => {
    const nodes = [modelNode(), modelNode(), modelNode()];
    const result = buildOutlineNodeList(nodes, {});
    expect(result).toHaveLength(1);
    expect(readStringField(result[0]!, "name")).toBe("3 turns");
  });

  it("collapses consecutive score events into a scoring row", () => {
    const nodes = [
      eventNode(testScoreEvent()),
      eventNode(testScoreEvent()),
      eventNode(testErrorEvent()),
    ];
    const result = buildOutlineNodeList(nodes, {});
    expect(result.map((n) => readStringField(n, "name"))).toEqual([
      "scoring",
      undefined,
    ]);
  });

  it("does not descend into collapsed nodes", () => {
    const span = eventNode(
      testSpanBeginEvent({ name: "agent", type: "agent" }),
      [modelNode()]
    );
    const expanded = buildOutlineNodeList([span], {});
    expect(expanded.map((n) => readStringField(n, "type"))).toEqual([
      "agent",
      "turns",
    ]);

    const collapsed = buildOutlineNodeList([span], { [span.id]: true });
    expect(collapsed.map((n) => readStringField(n, "type"))).toEqual(["agent"]);
  });
});

// =============================================================================
// useOutlineNodes
// =============================================================================

describe("useOutlineNodes", () => {
  it("preserves derived list identities when inputs are unchanged", () => {
    const span = eventNode(
      testSpanBeginEvent({ name: "agent", type: "agent" }),
      [modelNode()]
    );
    const eventNodes = [span];
    const collapsedIds = {};
    const { result, rerender } = renderHook(() =>
      useOutlineNodes(eventNodes, collapsedIds)
    );
    const firstOutlineNodeList = result.current.outlineNodeList;
    const firstAllNodesList = result.current.allNodesList;

    rerender();

    expect(result.current.outlineNodeList).toBe(firstOutlineNodeList);
    expect(result.current.allNodesList).toBe(firstAllNodesList);
  });
});
