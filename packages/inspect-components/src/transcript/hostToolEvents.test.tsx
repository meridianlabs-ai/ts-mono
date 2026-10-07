// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testSandboxEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
  testToolCall,
  testToolEvent,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type {
  ChatMessage,
  Event,
  ModelEvent,
  ToolCall,
} from "@tsmono/inspect-common/types";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
  ContentTrustProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  makeReactiveStateHooks,
  ResizeObserverStub,
  testIcons,
} from "@tsmono/react/testing";

import { computeToolEventIdsAtLevel } from "./hasToolEventsAtDepth";
import { buildEventNodes } from "./hooks/useEventNodes";
import { ModelEventView } from "./ModelEventView";
import { recentInputMessages } from "./recentInputMessages";
import { flatTree } from "./transform/flatten";
import { EventNode, EventNodeContext, eventNodeOf } from "./types";

// A bridged turn: the model proposes a host tool call (executed by Inspect,
// so it has a tool event) and a call the agent runs itself (no tool event).
// Host tool events take the native layout: the event beside its `tool` span,
// with the tool's own events inside the span.

const hostCall = testToolCall({
  id: "host_1",
  function: "mcp__host__read_file",
  arguments: { path: "host-notes.txt" },
});
const agentCall = testToolCall({
  id: "agent_1",
  function: "Bash",
  arguments: { command: "agent-listing" },
});

const secondAgentCall = testToolCall({
  id: "agent_2",
  function: "Bash",
  arguments: { command: "agent-status" },
});

let clock = 0;
const at = () => ({
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
});

const proposingModel = (calls: ToolCall[], span_id: string | null) =>
  testModelEvent({
    ...at(),
    uuid: "model_propose",
    span_id,
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ content: "", tool_calls: calls }),
        }),
      ],
    }),
  });

const resultModel = (calls: ToolCall[], span_id: string | null) =>
  testModelEvent({
    ...at(),
    uuid: "model_result",
    span_id,
    input: [
      testUserMessage({ id: "u1" }),
      testAssistantMessage({ id: "a1", content: "", tool_calls: calls }),
      ...calls.map((call) =>
        testToolMessage({
          id: `result_${call.id}`,
          tool_call_id: call.id,
          content: `result of ${call.id}`,
        })
      ),
    ],
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ content: "done" }),
        }),
      ],
    }),
  });

/** A host tool event in its `tool` span, as the sandbox bridge records it. */
const hostExecution = (
  id: string,
  parent: string | null,
  nested: boolean,
  proposalId = id
): Event[] => {
  const spanId = `tool_span_${id}`;
  // the event is constructed (and timestamped) before its span begins
  const eventTime = at();
  return [
    testSpanBeginEvent({
      ...at(),
      uuid: spanId,
      id: spanId,
      parent_id: parent,
      span_id: parent,
      type: "tool",
      name: "read_file",
    }),
    testToolEvent({
      ...eventTime,
      uuid: `event_${id}`,
      id,
      span_id: parent,
      function: "read_file",
      arguments: { path: "host-notes.txt" },
      result: "contents",
      metadata: {
        bridge: {
          server: "host",
          tool: "read_file",
          function: "mcp__host__read_file",
          proposal_id: proposalId,
          grant: "consumed",
        },
      },
    }),
    ...(nested
      ? [testSandboxEvent({ ...at(), uuid: `sandbox_${id}`, span_id: spanId })]
      : []),
    testSpanEndEvent({ ...at(), id: spanId, span_id: spanId }),
  ];
};

const flatNodes = (events: Event[]): EventNode[] =>
  flatTree(buildEventNodes(events, false).eventNodes, null);

const nodeFor = (nodes: EventNode[], id: string): EventNode => {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
};

const toolEventIdsFor = (
  nodes: EventNode[],
  id: string
): ReadonlySet<string> => {
  const ids =
    computeToolEventIdsAtLevel(nodes)[nodes.indexOf(nodeFor(nodes, id))];
  if (!ids) throw new Error(`no tool event ids for ${id}`);
  return ids;
};

const recentFor = (nodes: EventNode[], id: string): ChatMessage[] =>
  recentInputMessages(eventNodeOf(nodeFor(nodes, id), "model").event.input, {
    agentResultsFiltered: false,
    hasToolEvents: true,
    toolEventIds: toolEventIdsFor(nodes, id),
  });

const topLevelTurn = (): Event[] => [
  proposingModel([hostCall, agentCall], null),
  ...hostExecution("host_1", null, true),
  resultModel([hostCall, agentCall], null),
];

const agentSpanTurn = (): Event[] => [
  testSpanBeginEvent({
    ...at(),
    id: "agent-sub",
    type: "agent",
    name: "sub",
  }),
  proposingModel([hostCall, agentCall], "agent-sub"),
  ...hostExecution("host_1", "agent-sub", true),
  resultModel([hostCall, agentCall], "agent-sub"),
  testSpanEndEvent({ ...at(), id: "agent-sub", span_id: "agent-sub" }),
];

describe("host tool events in a bridged turn", () => {
  it("lays a host call out as native calls are: a panel beside its tool span", () => {
    const nodes = flatNodes(topLevelTurn());

    expect(nodes.map((n) => [n.id, n.depth])).toEqual([
      ["model_propose", 0],
      ["tool_span_host_1", 0],
      ["sandbox_host_1", 1],
      ["event_host_1", 0],
      ["model_result", 0],
    ]);
    expect(nodeFor(nodes, "event_host_1").children).toEqual([]);
  });

  it("shows no span row for a host call without nested events", () => {
    const nodes = flatNodes([
      proposingModel([hostCall], null),
      ...hostExecution("host_1", null, false),
    ]);

    expect(nodes.map((n) => n.id)).toEqual(["model_propose", "event_host_1"]);
  });

  it.each([
    ["at the top level", topLevelTurn],
    ["inside an agent span", agentSpanTurn],
  ])("covers only the host call's id %s", (_where, fixture) => {
    const nodes = flatNodes(fixture());

    expect([...toolEventIdsFor(nodes, "model_propose")]).toEqual(["host_1"]);
    expect([...toolEventIdsFor(nodes, "model_result")]).toEqual(["host_1"]);
  });

  it.each([
    ["at the top level", topLevelTurn],
    ["inside an agent span", agentSpanTurn],
  ])("surfaces the agent-run result, not the host one, %s", (_w, fixture) => {
    const nodes = flatNodes(fixture());

    expect(recentFor(nodes, "model_result").map((m) => m.id)).toEqual([
      "result_agent_1",
    ]);
  });

  it("surfaces agent-run results on both sides of a host result", () => {
    const calls = [agentCall, hostCall, secondAgentCall];
    const nodes = flatNodes([
      proposingModel(calls, null),
      ...hostExecution("host_1", null, true),
      resultModel(calls, null),
    ]);

    expect(recentFor(nodes, "model_result").map((m) => m.id)).toEqual([
      "result_agent_1",
      "result_agent_2",
    ]);
  });

  it("covers both executions of a proposal run on two indistinct tools", () => {
    const nodes = flatNodes([
      proposingModel([hostCall], null),
      ...hostExecution("host_1", null, false),
      ...hostExecution("fresh_2", null, false, "host_1"),
      resultModel([hostCall], null),
    ]);

    expect(toolEventIdsFor(nodes, "model_propose").has("host_1")).toBe(true);
    expect(recentFor(nodes, "model_result")).toEqual([]);
  });

  it("leaves a native turn as it was: every call and result has its event", () => {
    const nativeCall = testToolCall({ id: "native_1", function: "bash" });
    const nodes = flatNodes([
      proposingModel([nativeCall], null),
      ...hostExecution("native_1", null, true),
      resultModel([nativeCall], null),
    ]);

    expect([...toolEventIdsFor(nodes, "model_propose")]).toEqual(["native_1"]);
    expect(recentFor(nodes, "model_result")).toEqual([]);
  });
});

describe("ModelEventView with tool events at its level", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderModel = (
    event: ModelEvent,
    showToolCalls: boolean,
    context: EventNodeContext
  ) =>
    render(
      <ComponentStateProvider hooks={makeReactiveStateHooks()}>
        <ComponentIconProvider icons={testIcons}>
          <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
            <ContentTrustProvider value="trusted">
              <ModelEventView
                eventNode={new EventNode<ModelEvent>("model", event, 0)}
                showToolCalls={showToolCalls}
                context={context}
              />
            </ContentTrustProvider>
          </ComponentNavigationProvider>
        </ComponentIconProvider>
      </ComponentStateProvider>
    );

  it("keeps the agent-run call inline and leaves the host call to its panel", () => {
    renderModel(proposingModel([hostCall, agentCall], null), false, {
      hasToolEvents: true,
      toolEventIds: new Set(["host_1"]),
    });

    expect(screen.queryAllByText(/agent-listing/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/host-notes\.txt/)).toEqual([]);
  });

  it.each([
    ["host result first", [hostCall, agentCall], ["agent_1"]],
    ["agent result first", [agentCall, hostCall], ["agent_1"]],
    [
      "interleaved",
      [agentCall, hostCall, secondAgentCall],
      ["agent_1", "agent_2"],
    ],
  ])(
    "shows the agent-run results in the summary (%s)",
    (_order, calls, shown) => {
      renderModel(resultModel(calls, null), true, {
        hasToolEvents: true,
        toolEventIds: new Set(["host_1"]),
      });

      for (const id of shown) {
        expect(
          screen.queryAllByText(new RegExp(`result of ${id}`)).length
        ).toBeGreaterThan(0);
      }
      expect(screen.queryAllByText(/result of host_1/)).toEqual([]);
    }
  );

  it("omits every call when no coverage is given and the next node is a tool", () => {
    renderModel(proposingModel([hostCall, agentCall], null), false, {
      hasToolEvents: true,
    });

    expect(screen.queryAllByText(/agent-listing/)).toEqual([]);
    expect(screen.queryAllByText(/host-notes\.txt/)).toEqual([]);
  });
});
