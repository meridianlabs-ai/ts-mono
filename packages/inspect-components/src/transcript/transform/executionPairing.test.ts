import { describe, expect, it } from "vitest";

import {
  testApprovalEvent,
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testSentinelEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type {
  ApprovalEvent,
  Event,
  SentinelEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { deriveActivityData } from "../../sample-activity/activityData";

import { pairToolApprovals } from "./toolApprovals";
import { pairToolSentinels, type SentinelStep } from "./toolSentinels";
import { treeifyEvents } from "./treeify";

// Events shaped as inspect_ai records a sandbox bridge's host calls under a
// sentinel (inspect_ai#6370): the model proposes `host_1`, the bridge hands a
// repeat of it to its scaffold as `tok`, and the approvals and checks of that
// run record `execution_id: "tok"`.
const kSolver = "solver";
const kModelId = "host_1";

const solverBegin = testSpanBeginEvent({
  id: kSolver,
  name: "solver",
  type: "solver",
});

const proposal = (uuid: string, count = 1): Event =>
  testModelEvent({
    uuid,
    span_id: kSolver,
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({
            tool_calls: Array.from({ length: count }, () =>
              testToolCall({
                id: kModelId,
                function: "mcp__host__read_file",
                arguments: { path: "notes.txt" },
              })
            ),
          }),
        }),
      ],
    }),
  });

const approval = (
  uuid: string,
  execution?: string,
  overrides: Partial<ApprovalEvent> = {}
): Event =>
  testApprovalEvent({
    uuid,
    span_id: kSolver,
    approver: "human",
    call: testToolCall({ id: kModelId, function: "read_file" }),
    execution_id: execution,
    ...overrides,
  });

/** A step's span, with its one check, as `sentinel_bridge` or a native `sentinel`. */
const check = (
  span: string,
  stage: SentinelEvent["stage"],
  execution?: string,
  overrides: Partial<SentinelEvent> = {},
  name = "sentinel_bridge",
  parent = kSolver
): Event[] => [
  testSpanBeginEvent({
    id: span,
    name,
    type: "sentinel",
    parent_id: parent,
    span_id: parent,
  }),
  testSentinelEvent({
    uuid: span,
    span_id: span,
    stage,
    step_id: kModelId,
    execution_id: execution,
    kind: "observation",
    action: null,
    ...overrides,
  }),
  testSpanEndEvent({ id: span, span_id: parent }),
];

const hostTool = (
  uuid: string,
  id: string,
  overrides: Partial<ToolEvent> = {}
): Event =>
  testToolEvent({
    uuid,
    id,
    function: "read_file",
    span_id: kSolver,
    metadata: {
      bridge: {
        server: "host",
        tool: "read_file",
        function: "mcp__host__read_file",
        proposal_id: kModelId,
        grant: "consumed",
      },
    },
    ...overrides,
  });

/**
 * An auto-approval of a run elsewhere that a bridge handed over under a new
 * id. Inspect records `execution_id` only for such runs, so a sample needs
 * one to pair by execution; this one pairs with no tool and renders nothing.
 */
const handedOverElsewhere = (): Event =>
  testApprovalEvent({
    uuid: "elsewhere",
    span_id: kSolver,
    approver: "auto",
    decision: "approve",
    call: testToolCall({ id: "elsewhere", function: "read_file" }),
    execution_id: "elsewhere-run",
  });

const pair = (events: Event[]) => {
  const nodes = treeifyEvents([solverBegin, ...events], 0);
  return {
    sentinels: pairToolSentinels(nodes),
    approvals: pairToolApprovals(nodes),
  };
};

const stepId = (step: SentinelStep | undefined) => step?.id;

/** The panel of each tool node: its proposal's id, its steps and its approvals. */
const panels = (events: Event[]) => {
  const { sentinels, approvals } = pair(events);
  const ids = new Set([
    ...sentinels.toolSentinels.keys(),
    ...approvals.toolApprovals.keys(),
  ]);
  return {
    panels: Object.fromEntries(
      [...ids].sort().map((id) => {
        const paired = sentinels.toolSentinels.get(id);
        return [
          id,
          {
            proposed: paired?.proposed?.id,
            before: stepId(paired?.before),
            after: stepId(paired?.after),
            approvals: approvals.toolApprovals.get(id)?.map((n) => n.id) ?? [],
          },
        ];
      })
    ),
    standalone: [...sentinels.standaloneSentinels.values()]
      .map((step) => step.id)
      .sort(),
  };
};

describe("pairing a call a bridge handed over under a new id", () => {
  describe("two runs of one model call that share its id", () => {
    const proposed = [proposal("m1", 2)];
    const reviews = [
      approval("a-model"),
      approval("a-tok", "tok"),
      ...check("call-model", "tool_call"),
      ...check("call-tok", "tool_call", "tok"),
    ];
    const tools = {
      model: hostTool("t-model", kModelId),
      tok: hostTool("t-tok", "tok"),
    };
    const results = {
      model: check("result-model", "tool_result"),
      tok: check("result-tok", "tool_result", "tok"),
    };
    const expected = {
      panels: {
        "t-model": {
          proposed: kModelId,
          before: "call-model",
          after: "result-model",
          approvals: ["a-model"],
        },
        "t-tok": {
          proposed: kModelId,
          before: "call-tok",
          after: "result-tok",
          approvals: ["a-tok"],
        },
      },
      standalone: [],
    };

    it.each([
      ["model's id", "model's id", ["model", "tok"], ["model", "tok"]],
      ["model's id", "token", ["model", "tok"], ["tok", "model"]],
      ["token", "model's id", ["tok", "model"], ["model", "tok"]],
      ["token", "token", ["tok", "model"], ["tok", "model"]],
    ] as const)(
      "gives each run its own checks and approvals when the run under the %s starts first and the one under the %s completes first",
      (_started, _completed, starts, completions) => {
        const events = [
          ...proposed,
          ...reviews,
          ...starts.map((run) => tools[run]),
          ...completions.flatMap((run) => results[run]),
        ];
        expect(panels(events)).toEqual(expected);
      }
    );

    it("pairs the run under the token with its checks when its tool sorts ahead of them", () => {
      const events = [
        ...proposed,
        tools.tok,
        ...reviews,
        tools.model,
        ...results.model,
        ...results.tok,
      ];
      expect(panels(events)).toEqual(expected);
    });

    it("gives each run of a call proposed again on a later turn its own proposal and checks", () => {
      const events = [
        proposal("m1"),
        approval("a-model"),
        ...check("call-model", "tool_call"),
        tools.model,
        ...results.model,
        proposal("m2"),
        approval("a-tok", "tok"),
        ...check("call-tok", "tool_call", "tok"),
        tools.tok,
        ...results.tok,
      ];
      expect(panels(events)).toEqual(expected);
    });

    it("leaves a run's checks on their own when no tool ran under its id", () => {
      const events = [...proposed, ...reviews, tools.model, ...results.model];
      expect(panels(events)).toEqual({
        panels: { "t-model": expected.panels["t-model"] },
        standalone: ["call-tok"],
      });
      expect(pair(events).approvals.hiddenApprovalIds.has("a-tok")).toBe(false);
    });
  });

  describe("two distinct calls the model proposed under one id", () => {
    // The bridge hands the second call to its scaffold as `tok`, which runs
    // it first; no approval policy records the original calls.
    const proposedTwice = testModelEvent({
      uuid: "m1",
      span_id: kSolver,
      output: testModelOutput({
        choices: [
          testChatCompletionChoice({
            message: testAssistantMessage({
              tool_calls: ["a.txt", "b.txt"].map((path) =>
                testToolCall({
                  id: kModelId,
                  function: "mcp__host__read_file",
                  arguments: { path },
                })
              ),
            }),
          }),
        ],
      }),
    });
    const ran = (uuid: string, id: string, path: string) =>
      hostTool(uuid, id, { arguments: { path } });
    const modify = (span: string, path: string, execution?: string) =>
      check(span, "tool_call", execution, {
        kind: "decision",
        action: "modify",
        modified: testToolCall({
          id: kModelId,
          function: "read_file",
          arguments: { path },
        }),
      });
    const shown = (events: Event[]) => {
      const { sentinels } = pair(events);
      return Object.fromEntries(
        ["t-model", "t-tok"].map((id) => {
          const paired = sentinels.toolSentinels.get(id);
          return [
            id,
            {
              proposed: paired?.proposed?.arguments,
              before: stepId(paired?.before),
              after: stepId(paired?.after),
            },
          ];
        })
      );
    };

    it("shows neither run a proposal, even when their arguments match one, when the run under the token starts first", () => {
      const events = [
        proposedTwice,
        ran("t-tok", "tok", "b.txt"),
        ran("t-model", kModelId, "a.txt"),
        ...check("result-tok", "tool_result", "tok", {
          kind: "decision",
          action: "terminate",
        }),
        ...check("result-model", "tool_result"),
      ];
      expect(shown(events)).toEqual({
        "t-model": {
          proposed: undefined,
          before: undefined,
          after: "result-model",
        },
        "t-tok": {
          proposed: undefined,
          before: undefined,
          after: "result-tok",
        },
      });
    });

    it("shows no proposal for the only run when two were proposed under its id", () => {
      const events = [
        proposedTwice,
        ran("t-tok", "tok", "b.txt"),
        ...check("result-tok", "tool_result", "tok", {
          kind: "decision",
          action: "terminate",
        }),
      ];
      expect(shown(events)["t-tok"]).toEqual({
        proposed: undefined,
        before: undefined,
        after: "result-tok",
      });
    });

    it("shows no proposal for runs a check modified, which their records cannot tell apart", () => {
      const events = [
        proposedTwice,
        ...modify("call-model", "a.txt.safe"),
        ...modify("call-tok", "b.txt.safe", "tok"),
        ran("t-tok", "tok", "b.txt.safe"),
        ran("t-model", kModelId, "a.txt.safe"),
      ];
      expect(shown(events)).toEqual({
        "t-model": {
          proposed: undefined,
          before: "call-model",
          after: undefined,
        },
        "t-tok": { proposed: undefined, before: "call-tok", after: undefined },
      });
    });

    it("does not take the other proposal for a run a check modified into its arguments", () => {
      const events = [
        proposedTwice,
        ...modify("call-tok", "a.txt", "tok"),
        ran("t-tok", "tok", "a.txt"),
      ];
      expect(shown(events)["t-tok"]).toEqual({
        proposed: undefined,
        before: "call-tok",
        after: undefined,
      });
    });

    it("keeps a native check that recorded before either run off the host run that started first", () => {
      const events = [
        handedOverElsewhere(),
        proposedTwice,
        ...check(
          "native-call",
          "tool_call",
          undefined,
          {
            kind: "decision",
            action: "modify",
            modified: testToolCall({
              id: kModelId,
              function: "read_file",
              arguments: { path: "a.safe" },
            }),
          },
          "sentinel"
        ),
        ...check("bridge-call", "tool_call", undefined, {
          kind: "decision",
          action: "proceed",
        }),
        ran("t-host", kModelId, "b.txt"),
        testToolEvent({
          uuid: "t-native",
          id: kModelId,
          function: "read_file",
          arguments: { path: "a.safe" },
          span_id: kSolver,
        }),
      ];
      const { sentinels } = pair(events);
      const shownFor = (id: string) => {
        const paired = sentinels.toolSentinels.get(id);
        return {
          proposed: paired?.proposed?.arguments,
          before: stepId(paired?.before),
        };
      };
      expect(shownFor("t-host")).toEqual({
        proposed: undefined,
        before: "bridge-call",
      });
      expect(shownFor("t-native")).toEqual({
        proposed: undefined,
        before: "native-call",
      });
    });

    it("shows a modified run the proposal its own approval recorded", () => {
      const events = [
        proposedTwice,
        approval("a-tok", "tok", {
          call: testToolCall({
            id: kModelId,
            function: "read_file",
            arguments: { path: "b.txt" },
          }),
        }),
        ...modify("call-tok", "b.txt.safe", "tok"),
        ran("t-tok", "tok", "b.txt.safe"),
        ran("t-model", kModelId, "a.txt"),
      ];
      expect(shown(events)).toEqual({
        "t-model": { proposed: undefined, before: undefined, after: undefined },
        "t-tok": {
          proposed: { path: "b.txt" },
          before: "call-tok",
          after: undefined,
        },
      });
    });
  });

  describe("two outputs outstanding together that propose one id", () => {
    // As inspect_ai's bridge records them: after a warm-up call under the
    // model's id, two outputs each propose it before the scaffold runs
    // either, a check modifies each, and the scaffold hands both back under
    // their tokens. No approval policy records the original calls.
    const output = (uuid: string, path: string): Event =>
      testModelEvent({
        uuid,
        span_id: kSolver,
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({
                tool_calls: [
                  testToolCall({
                    id: kModelId,
                    function: "mcp__host__read_file",
                    arguments: { path },
                  }),
                ],
              }),
            }),
          ],
        }),
      });
    const modifyTo = (span: string, path: string, execution?: string) =>
      check(span, "tool_call", execution, {
        kind: "decision",
        action: "modify",
        modified: testToolCall({
          id: kModelId,
          function: "read_file",
          arguments: { path },
        }),
      });
    const ran = (uuid: string, id: string, path: string) =>
      hostTool(uuid, id, { arguments: { path } });
    const warmUp = [
      output("m-warm", "warm"),
      ...modifyTo("call-warm", "warm.safe"),
      ran("t-warm", kModelId, "warm.safe"),
    ];
    const outputA = [
      output("m-a", "parent-a"),
      ...modifyTo("call-a", "parent-a.safe", "tok-a"),
    ];
    const outputB = [
      output("m-b", "parent-b"),
      ...modifyTo("call-b", "parent-b.safe", "tok-b"),
    ];
    const runs = {
      a: ran("t-a", "tok-a", "parent-a.safe"),
      b: ran("t-b", "tok-b", "parent-b.safe"),
    };
    const shown = (events: Event[]) => {
      const { sentinels } = pair(events);
      return Object.fromEntries(
        ["t-warm", "t-a", "t-b"].map((id) => {
          const paired = sentinels.toolSentinels.get(id);
          return [
            id,
            {
              proposed: paired?.proposed?.arguments,
              before: stepId(paired?.before),
            },
          ];
        })
      );
    };

    it.each([
      ["in reverse order", ["b", "a"]],
      ["in order", ["a", "b"]],
    ] as const)("shows no run a proposal when they run %s", (_order, order) => {
      const events = [
        ...warmUp,
        ...outputA,
        ...outputB,
        ...order.map((run) => runs[run]),
      ];
      expect(shown(events)).toEqual({
        "t-warm": { proposed: undefined, before: "call-warm" },
        "t-a": { proposed: undefined, before: "call-a" },
        "t-b": { proposed: undefined, before: "call-b" },
      });
    });

    it("shows neither run a proposal when a scaffold drops an undeclared argument from one and a check modifies the other", () => {
      // The bridge lets a scaffold drop bookkeeping arguments the served tool
      // does not declare, so A runs with exactly B's proposed arguments.
      const proposing = (uuid: string, args: Record<string, string>) =>
        testModelEvent({
          uuid,
          span_id: kSolver,
          output: testModelOutput({
            choices: [
              testChatCompletionChoice({
                message: testAssistantMessage({
                  tool_calls: [
                    testToolCall({
                      id: kModelId,
                      function: "mcp__host__read_file",
                      arguments: args,
                    }),
                  ],
                }),
              }),
            ],
          }),
        });
      const events = [
        proposing("m-a", { path: "a.txt", toolSummary: "A" }),
        ...check("call-a", "tool_call", undefined, {
          kind: "decision",
          action: "proceed",
        }),
        proposing("m-b", { path: "a.txt" }),
        ...modifyTo("call-b", "safe", "tok-b"),
        ran("t-a", kModelId, "a.txt"),
        ran("t-b", "tok-b", "safe"),
        ...check("result-b", "tool_result", "tok-b", {
          kind: "decision",
          action: "terminate",
        }),
      ];
      const { sentinels } = pair(events);
      const panel = (id: string) => {
        const paired = sentinels.toolSentinels.get(id);
        return {
          proposed: paired?.proposed,
          before: stepId(paired?.before),
          after: stepId(paired?.after),
        };
      };
      expect(panel("t-a")).toEqual({
        proposed: undefined,
        before: "call-a",
        after: undefined,
      });
      expect(panel("t-b")).toEqual({
        proposed: undefined,
        before: "call-b",
        after: "result-b",
      });
    });

    it("shows only the run its approval names a proposal, and no other run one by elimination", () => {
      const events = [
        ...warmUp,
        ...outputA,
        output("m-b", "parent-b"),
        approval("a-b", "tok-b", {
          call: testToolCall({
            id: kModelId,
            function: "read_file",
            arguments: { path: "parent-b" },
          }),
        }),
        ...modifyTo("call-b", "parent-b.safe", "tok-b"),
        runs.b,
        runs.a,
      ];
      expect(shown(events)).toEqual({
        "t-warm": { proposed: undefined, before: "call-warm" },
        "t-a": { proposed: undefined, before: "call-a" },
        "t-b": { proposed: { path: "parent-b" }, before: "call-b" },
      });
    });
  });

  it("keeps each run's checks of a call reviewed as two bridged tools sharing a description on its own tool", () => {
    // Each target is approved and checked before the call is handed over;
    // the scaffold runs it once.
    const run = (tool: string, execution?: string): Event[] => [
      approval(`a-${tool}-read`, execution),
      approval(`a-${tool}-copy`, execution, {
        call: testToolCall({ id: kModelId, function: "read_copy" }),
      }),
      ...check(`call-${tool}-read`, "tool_call", execution),
      ...check(`call-${tool}-copy`, "tool_call", execution),
      hostTool(`t-${tool}`, execution ?? kModelId),
      ...check(`result-${tool}`, "tool_result", execution),
    ];
    const events = [
      proposal("m1"),
      ...run("model"),
      proposal("m2"),
      ...run("tok", "tok"),
    ];

    const { panels: shown, standalone } = panels(events);
    for (const tool of ["model", "tok"]) {
      expect(shown[`t-${tool}`]).toEqual({
        proposed: kModelId,
        before: `call-${tool}-read`,
        after: `result-${tool}`,
        approvals: [`a-${tool}-read`, `a-${tool}-copy`],
      });
    }
    expect(standalone).toEqual(["call-model-copy", "call-tok-copy"]);
  });

  describe("a monitor's own call under the model's id", () => {
    // The monitor checking the agent's native call runs its own native call
    // inside the check's span, under the same id.
    const monitorRun = (span: string): Event[] => [
      testSpanBeginEvent({
        id: span,
        name: "sentinel",
        type: "sentinel",
        parent_id: kSolver,
        span_id: kSolver,
      }),
      testModelEvent({ uuid: `${span}-model`, span_id: span, role: "monitor" }),
      approval(`${span}-approval`, undefined, {
        span_id: span,
        call: testToolCall({ id: kModelId, function: "lookup" }),
      }),
      testToolEvent({
        uuid: `${span}-tool`,
        id: kModelId,
        function: "lookup",
        span_id: span,
      }),
      testSentinelEvent({
        uuid: `${span}-check`,
        span_id: span,
        stage: "tool_call",
        step_id: kModelId,
        action: "proceed",
      }),
      testSpanEndEvent({ id: span, span_id: kSolver }),
    ];

    it("stays with the monitor's own tool, and the agent's approval and check with the agent's", () => {
      const events = [
        handedOverElsewhere(),
        proposal("m1"),
        approval("a-agent"),
        ...monitorRun("monitor"),
        testToolEvent({
          uuid: "t-agent",
          id: kModelId,
          function: "read_file",
          span_id: kSolver,
        }),
      ];
      expect(panels(events)).toEqual({
        panels: {
          "monitor-tool": {
            proposed: undefined,
            before: undefined,
            after: undefined,
            approvals: ["monitor-approval"],
          },
          "t-agent": {
            proposed: kModelId,
            before: "monitor-check",
            after: undefined,
            approvals: ["a-agent"],
          },
        },
        standalone: [],
      });
    });
  });

  describe("calls of nested and sibling agents that share an id", () => {
    const outputOf = (
      uuid: string,
      span: string,
      calls: { id: string; fn?: string; path: string }[]
    ): Event =>
      testModelEvent({
        uuid,
        span_id: span,
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({
                tool_calls: calls.map(({ id, fn, path }) =>
                  testToolCall({
                    id,
                    function: fn ?? "mcp__host__read_file",
                    arguments: { path },
                  })
                ),
              }),
            }),
          ],
        }),
      });
    /** A tool that runs the agent `child`, whose events are `events`. */
    const delegateTo = (child: string, events: Event[]): Event[] => [
      testSpanBeginEvent({
        id: `${child}-tool`,
        name: "delegate",
        type: "tool",
        parent_id: kSolver,
        span_id: kSolver,
      }),
      testToolEvent({
        uuid: `t-${child}-delegate`,
        id: `delegate-${child}`,
        function: "delegate",
        span_id: `${child}-tool`,
      }),
      testSpanBeginEvent({
        id: child,
        name: child,
        type: "agent",
        parent_id: `${child}-tool`,
        span_id: `${child}-tool`,
      }),
      ...events,
      testSpanEndEvent({ id: child, span_id: `${child}-tool` }),
      testSpanEndEvent({ id: `${child}-tool`, span_id: kSolver }),
    ];
    const ranIn = (span: string, uuid: string, id: string, path: string) =>
      hostTool(uuid, id, { span_id: span, arguments: { path } });
    const native = (span: string, uuid: string, path: string) =>
      testToolEvent({
        uuid,
        id: kModelId,
        function: "read_file",
        span_id: span,
        arguments: { path },
      });
    const decision = (
      action: NonNullable<SentinelEvent["action"]>,
      modified?: string
    ): Partial<SentinelEvent> => ({
      kind: "decision",
      action,
      modified:
        modified === undefined
          ? undefined
          : testToolCall({
              id: kModelId,
              function: "read_file",
              arguments: { path: modified },
            }),
    });
    const shown = (events: Event[]) => {
      const { panels: byTool, standalone } = panels(events);
      const { sentinels } = pair(events);
      return {
        panels: Object.fromEntries(
          Object.entries(byTool)
            .filter(([id]) => !id.endsWith("-delegate"))
            .map(([id, panel]) => [
              id,
              {
                ...panel,
                proposed: sentinels.toolSentinels.get(id)?.proposed?.arguments,
              },
            ])
        ),
        standalone,
      };
    };

    it("shows a parent's run under a token the parent's proposal when a delegated agent proposed the same id", () => {
      const events = [
        outputOf("m-first", kSolver, [{ id: kModelId, path: "first.txt" }]),
        ranIn(kSolver, "t-first", kModelId, "first.txt"),
        outputOf("m-second", kSolver, [
          { id: "delegate-child", fn: "delegate", path: "notes" },
          { id: kModelId, path: "parent.txt" },
        ]),
        approval("a-parent", "tok", {
          call: testToolCall({
            id: kModelId,
            function: "read_file",
            arguments: { path: "parent.txt" },
          }),
        }),
        ...check(
          "parent-call",
          "tool_call",
          "tok",
          decision("modify", "parent.safe")
        ),
        ...delegateTo("child", [
          outputOf("m-child", "child", [{ id: kModelId, path: "child.txt" }]),
          ...check(
            "child-call",
            "tool_call",
            undefined,
            {},
            "sentinel_bridge",
            "child"
          ),
          ranIn("child", "t-child", kModelId, "child.txt"),
        ]),
        ranIn(kSolver, "t-parent", "tok", "parent.safe"),
        ...check("parent-result", "tool_result", "tok", decision("terminate")),
      ];
      expect(shown(events)).toEqual({
        panels: {
          "t-child": {
            proposed: { path: "child.txt" },
            before: "child-call",
            after: undefined,
            approvals: [],
          },
          "t-parent": {
            proposed: { path: "parent.txt" },
            before: "parent-call",
            after: "parent-result",
            approvals: ["a-parent"],
          },
        },
        standalone: [],
      });
    });

    it("keeps a parent's approval, check and proposal off a delegated agent's native call under the same id", () => {
      const approved = (uuid: string, span: string, path: string) =>
        approval(uuid, undefined, {
          span_id: span,
          call: testToolCall({
            id: kModelId,
            function: "read_file",
            arguments: { path },
          }),
        });
      const events = [
        handedOverElsewhere(),
        outputOf("m-parent", kSolver, [
          { id: "delegate-child", fn: "delegate", path: "notes" },
          { id: kModelId, path: "parent.txt" },
        ]),
        approved("a-parent", kSolver, "parent.txt"),
        ...check("parent-call", "tool_call", undefined, {}, "sentinel"),
        ...delegateTo("child", [
          outputOf("m-child", "child", [{ id: kModelId, path: "child.txt" }]),
          approved("a-child", "child", "child.txt"),
          ...check(
            "child-call",
            "tool_call",
            undefined,
            {},
            "sentinel",
            "child"
          ),
          native("child", "t-child", "child.txt"),
        ]),
        native(kSolver, "t-parent", "parent.txt"),
      ];
      expect(shown(events)).toEqual({
        panels: {
          "t-child": {
            proposed: { path: "child.txt" },
            before: "child-call",
            after: undefined,
            approvals: ["a-child"],
          },
          "t-parent": {
            proposed: { path: "parent.txt" },
            before: "parent-call",
            after: undefined,
            approvals: ["a-parent"],
          },
        },
        standalone: [],
      });
    });

    describe("a bridge check outside the conversation its call ran in", () => {
      // A model event sink can run a bridged generation in a sub-agent while
      // the bridge's check span stays under the outer conversation.
      const inner = (type: "agent" | "subtask"): Event[] => [
        testSpanBeginEvent({
          id: "inner",
          name: "explorer",
          type,
          parent_id: kSolver,
          span_id: kSolver,
        }),
        outputOf("m-inner", "inner", [{ id: kModelId, path: "inner.txt" }]),
        ranIn("inner", "t-inner", kModelId, "inner.txt"),
      ];

      it("pairs with the call in the sub-agent it recorded as its conversation", () => {
        const events = [
          ...inner("agent"),
          testSpanEndEvent({ id: "inner", span_id: kSolver }),
          ...check("routed", "tool_result", undefined, {
            conversation: "inner",
          }),
        ];
        expect(shown(events).panels["t-inner"]?.after).toBe("routed");
      });

      it("stays with the calls of the subtask it sits in, under the agent it recorded", () => {
        const events = [
          ...inner("subtask"),
          ...check(
            "in-subtask",
            "tool_result",
            undefined,
            { conversation: kSolver },
            "sentinel_bridge",
            "inner"
          ),
          testSpanEndEvent({ id: "inner", span_id: kSolver }),
        ];
        expect(shown(events).panels["t-inner"]?.after).toBe("in-subtask");
      });
    });

    it("gives sibling agents running in parallel each their own proposal and checks under a shared id", () => {
      // Each sibling records its result check outside a sentinel span, as
      // older logs do.
      const resultIn = (span: string, uuid: string): Event =>
        testSentinelEvent({
          uuid,
          span_id: span,
          stage: "tool_result",
          step_id: kModelId,
          conversation: span,
          ...decision("reject"),
        });
      const events = [
        handedOverElsewhere(),
        outputOf("m-parent", kSolver, [
          { id: "delegate-a", fn: "delegate", path: "a" },
          { id: "delegate-b", fn: "delegate", path: "b" },
        ]),
        ...delegateTo("a", [
          outputOf("m-a", "a", [{ id: kModelId, path: "a.txt" }]),
          ...check("a-call", "tool_call", undefined, {}, "sentinel", "a"),
          native("a", "t-a", "a.txt"),
          resultIn("a", "a-result"),
        ]),
        ...delegateTo("b", [
          outputOf("m-b", "b", [{ id: kModelId, path: "b.txt" }]),
          ...check("b-call", "tool_call", undefined, {}, "sentinel", "b"),
          native("b", "t-b", "b.txt"),
          resultIn("b", "b-result"),
        ]),
      ];
      expect(shown(events)).toEqual({
        panels: {
          "t-a": {
            proposed: { path: "a.txt" },
            before: "a-call",
            after: "a-result",
            approvals: [],
          },
          "t-b": {
            proposed: { path: "b.txt" },
            before: "b-call",
            after: "b-result",
            approvals: [],
          },
        },
        standalone: [],
      });
    });
  });

  it("keeps a native check off a host call under its id, and a bridge check off a native one", () => {
    const events = [
      handedOverElsewhere(),
      proposal("m1", 2),
      ...check("native-call", "tool_call", undefined, {}, "sentinel"),
      ...check("bridge-call", "tool_call"),
      hostTool("t-host", kModelId),
      testToolEvent({ uuid: "t-native", id: kModelId, span_id: kSolver }),
    ];
    const { sentinels } = pair(events);
    expect(stepId(sentinels.toolSentinels.get("t-host")?.before)).toBe(
      "bridge-call"
    );
    expect(stepId(sentinels.toolSentinels.get("t-native")?.before)).toBe(
      "native-call"
    );
  });

  describe("the transcript and Activity reading one run alike", () => {
    // Two outputs propose different calls under the model's id, so neither
    // names a run's proposal; only a run's own records can.
    const proposing = (uuid: string, path: string): Event =>
      testModelEvent({
        uuid,
        span_id: kSolver,
        requested_model: "client",
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({
                tool_calls: [
                  testToolCall({
                    id: kModelId,
                    function: "mcp__host__read_file",
                    arguments: { path },
                  }),
                ],
              }),
            }),
          ],
        }),
      });
    const ran = (uuid: string, id: string, path: string) =>
      hostTool(uuid, id, { arguments: { path } });
    const decide = (
      span: string,
      stage: SentinelEvent["stage"],
      action: NonNullable<SentinelEvent["action"]>,
      execution?: string,
      path?: string
    ) =>
      check(span, stage, execution, {
        kind: "decision",
        action,
        modified:
          path === undefined
            ? null
            : testToolCall({
                id: kModelId,
                function: "read_file",
                arguments: { path },
              }),
      });
    const reviewed = (uuid: string, fn: string, path: string) =>
      approval(uuid, "tok", {
        call: testToolCall({ id: kModelId, function: fn, arguments: { path } }),
      });
    /** Each tool's proposal and steps in the transcript, and Activity's rows. */
    const stamped = (events: Event[]) =>
      [solverBegin, ...events].map((event, i) => ({
        ...event,
        timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      }));
    const views = (unstamped: Event[]) => {
      const events = stamped(unstamped);
      const { toolSentinels } = pairToolSentinels(treeifyEvents(events, 0));
      return {
        transcript: Object.fromEntries(
          [...toolSentinels].map(([id, paired]) => [
            id,
            {
              proposed: paired.proposed && {
                function: paired.proposed.function,
                arguments: paired.proposed.arguments,
              },
              before: stepId(paired.before),
              after: stepId(paired.after),
            },
          ])
        ),
        activity: deriveActivityData({ events }).rows.map((row) => [
          row.key,
          row.mono,
          row.tail,
        ]),
      };
    };

    describe("a call two bridged tools sharing a description could denote", () => {
      const runs = (approvals: Event[]) => [
        proposing("m-a", "a"),
        ran("t-a", kModelId, "a"),
        proposing("m-b", "b"),
        ...approvals,
        ran("t-b", "tok", "b"),
        ...decide("result-b", "tool_result", "terminate", "tok"),
      ];
      const read = reviewed("a-read", "read_file", "b");
      const copy = reviewed("a-copy", "read_copy", "b");

      it.each([
        ["the executed tool's first", [read, copy]],
        ["the other tool's first", [copy, read]],
      ])(
        "names the run's tool from the approval of the tool it executed, with %s approval recorded",
        (_first, approvals) => {
          const shown = views(runs(approvals));
          expect(shown.transcript["t-b"]).toEqual({
            proposed: { function: "read_file", arguments: { path: "b" } },
            before: undefined,
            after: "result-b",
          });
          expect(shown.activity).toEqual([
            ["result-b", "read_file: b", "terminated"],
          ]);
        }
      );

      it("names the run from its ToolEvent, not from the other tool's approval, when only that one is recorded", () => {
        const shown = views(runs([copy]));
        expect(shown.transcript["t-b"]?.proposed).toBeUndefined();
        expect(shown.activity).toEqual([
          ["result-b", "read_file: b", "terminated"],
        ]);
      });
    });

    it("labels the first run's before-call check from its own run when a second output proposes the id before it runs", () => {
      // No warm-up: the first run keeps the model's id, so its checks record
      // no `execution_id`.
      const shown = views([
        proposing("m-a", "a"),
        ...decide("call-a", "tool_call", "modify", undefined, "a.safe"),
        proposing("m-b", "b"),
        ...decide("call-b", "tool_call", "modify", "tok", "b.safe"),
        ran("t-a", kModelId, "a.safe"),
        ran("t-b", "tok", "b.safe"),
        ...decide("result-a", "tool_result", "terminate"),
        ...decide("result-b", "tool_result", "terminate", "tok"),
      ]);
      expect(shown.transcript).toEqual({
        "t-a": { proposed: undefined, before: "call-a", after: "result-a" },
        "t-b": { proposed: undefined, before: "call-b", after: "result-b" },
      });
      expect(shown.activity).toEqual([
        ["call-a", "read_file: a.safe", "modified"],
        ["call-b", "read_file: b.safe", "modified"],
        ["result-a", "read_file: a.safe", "terminated"],
        ["result-b", "read_file: b.safe", "terminated"],
      ]);
    });

    describe("a native and a bridge check of one id, both recorded before either run", () => {
      // After a run under the model's id, the bridge hands the repeat to its
      // scaffold under `tok`; the native call keeps the model's id.
      const events = (action: "modify" | "reject", hostFirst: boolean) => {
        const native = testToolEvent({
          uuid: "t-native",
          id: kModelId,
          function: "read_file",
          arguments: { path: action === "modify" ? "a.safe" : "a" },
          span_id: kSolver,
          error:
            action === "reject"
              ? { type: "approval", message: "Rejected by sentinel" }
              : undefined,
        });
        const host = ran("t-host", "tok", "b.safe");
        return [
          proposing("m-warm", "old"),
          ran("t-warm", kModelId, "old"),
          proposing("m", "a"),
          ...check(
            "native-call",
            "tool_call",
            undefined,
            {
              kind: "decision",
              action,
              modified:
                action === "modify"
                  ? testToolCall({
                      id: kModelId,
                      function: "read_file",
                      arguments: { path: "a.safe" },
                    })
                  : null,
            },
            "sentinel"
          ),
          ...decide("bridge-call", "tool_call", "modify", "tok", "b.safe"),
          ...(hostFirst ? [host, native] : [native, host]),
        ];
      };

      it.each([
        ["the host run", true],
        ["the native run", false],
      ])(
        "keeps a modify on the native run when %s runs first",
        (_first, hostFirst) => {
          const shown = views(events("modify", hostFirst));
          expect(shown.transcript["t-native"]?.before).toBe("native-call");
          expect(shown.transcript["t-host"]?.before).toBe("bridge-call");
          expect(shown.activity).toEqual([
            ["native-call", "read_file: a.safe", "modified"],
            ["bridge-call", "read_file: b.safe", "modified"],
          ]);
        }
      );

      it.each([
        ["the host run", true],
        ["the native run", false],
      ])(
        "stands a rejection in for the native run's failed tool when %s runs first",
        (_first, hostFirst) => {
          const shown = views(events("reject", hostFirst));
          expect(shown.transcript["t-native"]?.before).toBe("native-call");
          expect(shown.activity).toEqual([
            ["native-call", "read_file: a", "rejected"],
            ["bridge-call", "read_file: b.safe", "modified"],
          ]);
          const turn = deriveActivityData({
            events: stamped(events("reject", hostFirst)),
          }).turns.at(-1);
          expect(turn?.tools.map((tool) => tool.uuid)).toEqual(["t-host"]);
          expect(turn?.rejected).toBe(1);
        }
      );
    });

    describe("a bridge attempt stopped before handover and retried under the same id", () => {
      // A bridge hands over only a call nothing stopped, so the stopped
      // attempt's approval and check keep no `execution_id`, like those of
      // the accepted retry, which runs under the model's id. A later run of
      // the id is handed over as `tok`, so the sample pairs by execution.
      const reviewedAs = (
        uuid: string,
        path: string,
        execution?: string,
        decision: ApprovalEvent["decision"] = "approve"
      ) =>
        approval(uuid, execution, {
          decision,
          call: testToolCall({
            id: kModelId,
            function: "read_file",
            arguments: { path },
          }),
        });
      const attempt = {
        check: [
          reviewedAs("a-blocked", "blocked"),
          ...decide("blocked", "tool_call", "reject"),
        ],
        approval: [reviewedAs("a-blocked", "blocked", undefined, "reject")],
      };
      const blocked = (stoppedBy: keyof typeof attempt) => [
        proposing("m-blocked", "blocked"),
        ...attempt[stoppedBy],
      ];
      const allowed = [
        proposing("m-allowed", "allowed"),
        reviewedAs("a-allowed", "allowed"),
        ...decide("accepted", "tool_call", "proceed"),
        ran("t-allowed", kModelId, "allowed"),
      ];
      const again = [
        proposing("m-again", "again"),
        reviewedAs("a-again", "again", "tok"),
        ...decide("again", "tool_call", "modify", "tok", "again.safe"),
        ran("t-again", "tok", "again.safe"),
      ];

      it.each([
        ["check", "before"],
        ["approval", "before"],
        ["check", "after"],
        ["approval", "after"],
      ] as const)(
        "keeps the attempt its %s stopped %s the run under the model's id off that run",
        (stoppedBy, when) => {
          const recorded = stamped(
            when === "before"
              ? [...blocked(stoppedBy), ...allowed, ...again]
              : [...allowed, ...blocked(stoppedBy), ...again]
          );
          const nodes = treeifyEvents(recorded, 0);
          const sentinels = pairToolSentinels(nodes);
          const approvals = pairToolApprovals(nodes);

          expect(
            Object.fromEntries(
              ["t-allowed", "t-again"].map((id) => [
                id,
                {
                  before: stepId(sentinels.toolSentinels.get(id)?.before),
                  approvals: approvals.toolApprovals.get(id)?.map((n) => n.id),
                },
              ])
            )
          ).toEqual({
            "t-allowed": { before: "accepted", approvals: ["a-allowed"] },
            "t-again": { before: "again", approvals: ["a-again"] },
          });
          // The stopped attempt's records stay on their own rows, and a deep
          // link to them lands there rather than on the retry's run.
          expect(approvals.hiddenApprovalIds.has("a-blocked")).toBe(false);
          expect(approvals.approvalScrollRedirects.has("a-blocked")).toBe(
            false
          );
          expect(
            [...sentinels.standaloneSentinels.values()].map(stepId)
          ).toEqual(stoppedBy === "check" ? ["blocked"] : []);
          expect(sentinels.sentinelScrollRedirects.get("blocked")).not.toBe(
            "t-allowed"
          );

          const activity = deriveActivityData({ events: recorded });
          expect(
            activity.turns.map((turn) => [
              turn.model?.uuid,
              turn.rejected,
              turn.tools.map((tool) => tool.uuid),
            ])
          ).toEqual(
            when === "before"
              ? [
                  ["m-blocked", 1, []],
                  ["m-allowed", 0, ["t-allowed"]],
                  ["m-again", 0, ["t-again"]],
                ]
              : [
                  ["m-allowed", 0, ["t-allowed"]],
                  ["m-blocked", 1, []],
                  ["m-again", 0, ["t-again"]],
                ]
          );
        }
      );
    });

    describe("a bridge output discarded for a sibling's rejection, then retried under the same id", () => {
      // The bridge rejects a whole output when any of its calls is rejected,
      // so the sibling's approval and check, which let it through, judged a
      // call that never ran and was never handed over (no `execution_id`).
      const kSibling = "host_2";
      const call = (id: string, path: string) =>
        testToolCall({
          id,
          function: "mcp__host__read_file",
          arguments: { path },
        });
      const discardedOutput = testModelEvent({
        uuid: "m-discarded",
        span_id: kSolver,
        requested_model: "client",
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({
                tool_calls: [
                  call(kModelId, "discarded-c"),
                  call(kSibling, "discarded-d"),
                ],
              }),
            }),
          ],
        }),
      });
      const reviewedAs = (
        uuid: string,
        id: string,
        path: string,
        execution?: string,
        decision: ApprovalEvent["decision"] = "approve"
      ) =>
        approval(uuid, execution, {
          decision,
          call: testToolCall({
            id,
            function: "read_file",
            arguments: { path },
          }),
        });
      const discarded = {
        check: [
          discardedOutput,
          reviewedAs("a-discarded-c", kModelId, "discarded-c"),
          reviewedAs("a-discarded-d", kSibling, "discarded-d"),
          ...decide(
            "discarded-c",
            "tool_call",
            "modify",
            undefined,
            "discarded-c.safe"
          ),
          ...check("discarded-d", "tool_call", undefined, {
            step_id: kSibling,
            kind: "decision",
            action: "reject",
          }),
        ],
        approval: [
          discardedOutput,
          reviewedAs("a-discarded-c", kModelId, "discarded-c"),
          reviewedAs(
            "a-discarded-d",
            kSibling,
            "discarded-d",
            undefined,
            "reject"
          ),
        ],
      };
      const retry = [
        proposing("m-retry", "retry-c"),
        reviewedAs("a-retry-c", kModelId, "retry-c"),
        ...decide("retry-c", "tool_call", "modify", undefined, "retry-c.safe"),
      ];
      const retryRuns = [
        ran("t-retry-c", kModelId, "retry-c.safe"),
        ...decide("result-c", "tool_result", "terminate"),
      ];
      // A later run handed over as `tok`, so the sample pairs by execution.
      const again = (path: string) => [
        reviewedAs("a-again", kModelId, path, "tok"),
        ...decide("again", "tool_call", "modify", "tok", `${path}.safe`),
        ran("t-again", "tok", `${path}.safe`),
      ];

      it.each(["check", "approval"] as const)(
        "keeps the discarded output's records off the retry's run when a sibling's %s stopped it",
        (stoppedBy) => {
          const recorded = stamped([
            ...discarded[stoppedBy],
            ...retry,
            ...retryRuns,
            proposing("m-again", "again"),
            ...again("again"),
          ]);
          const nodes = treeifyEvents(recorded, 0);
          const sentinels = pairToolSentinels(nodes);
          const approvals = pairToolApprovals(nodes);

          expect(
            Object.fromEntries(
              ["t-retry-c", "t-again"].map((id) => [
                id,
                {
                  before: stepId(sentinels.toolSentinels.get(id)?.before),
                  after: stepId(sentinels.toolSentinels.get(id)?.after),
                  approvals: approvals.toolApprovals.get(id)?.map((n) => n.id),
                },
              ])
            )
          ).toEqual({
            "t-retry-c": {
              before: "retry-c",
              after: "result-c",
              approvals: ["a-retry-c"],
            },
            "t-again": {
              before: "again",
              after: undefined,
              approvals: ["a-again"],
            },
          });
          // A deep link to the sibling's approval or check lands on its own
          // row, not on the retry's run.
          for (const id of ["a-discarded-c", "a-discarded-d"]) {
            expect(approvals.hiddenApprovalIds.has(id)).toBe(false);
            expect(approvals.approvalScrollRedirects.has(id)).toBe(false);
          }
          expect(
            [...sentinels.standaloneSentinels.values()].map(stepId).sort()
          ).toEqual(
            stoppedBy === "check" ? ["discarded-c", "discarded-d"] : []
          );
          expect(sentinels.sentinelScrollRedirects.get("discarded-c")).not.toBe(
            "t-retry-c"
          );

          expect(
            deriveActivityData({ events: recorded }).rows.map((row) => [
              row.key,
              row.mono,
              row.tail,
            ])
          ).toEqual([
            ...(stoppedBy === "check"
              ? [
                  ["discarded-c", "read_file: discarded-c", "modified"],
                  [
                    "discarded-d",
                    "mcp__host__read_file: discarded-d",
                    "rejected",
                  ],
                ]
              : [["a-discarded-d", "read_file: discarded-d", "rejected"]]),
            ["retry-c", "read_file: retry-c.safe", "modified"],
            ["result-c", "read_file: retry-c.safe", "terminated"],
            ["again", "read_file: again", "modified"],
          ]);
        }
      );

      it("keeps the discarded output's check off the retry's run when another output proposes the id before it runs", () => {
        const recorded = stamped([
          ...discarded.check,
          ...retry,
          proposing("m-next", "next"),
          ...retryRuns,
          ...again("next"),
        ]);
        const nodes = treeifyEvents(recorded, 0);
        const sentinels = pairToolSentinels(nodes);
        expect(stepId(sentinels.toolSentinels.get("t-retry-c")?.before)).toBe(
          "retry-c"
        );
        expect(
          deriveActivityData({ events: recorded }).rows.map((row) => [
            row.key,
            row.mono,
            row.tail,
          ])
        ).toEqual([
          ["discarded-c", "read_file: discarded-c", "modified"],
          ["discarded-d", "mcp__host__read_file: discarded-d", "rejected"],
          ["retry-c", "read_file: retry-c.safe", "modified"],
          ["result-c", "read_file: retry-c.safe", "terminated"],
          ["again", "read_file: next", "modified"],
        ]);
      });

      it("keeps the check that rejected the retried id itself off the retry's run when another output proposes the id before it runs", () => {
        // Checks stop at the first rejection, so the sibling is never checked.
        const recorded = stamped([
          discardedOutput,
          reviewedAs("a-discarded-c", kModelId, "discarded-c"),
          reviewedAs("a-discarded-d", kSibling, "discarded-d"),
          ...decide("discarded-c", "tool_call", "reject"),
          ...retry,
          proposing("m-next", "next"),
          ...retryRuns,
          ...again("next"),
        ]);
        const nodes = treeifyEvents(recorded, 0);
        expect(
          stepId(
            pairToolSentinels(nodes).toolSentinels.get("t-retry-c")?.before
          )
        ).toBe("retry-c");
        expect(
          pairToolApprovals(nodes)
            .toolApprovals.get("t-retry-c")
            ?.map((n) => n.id)
        ).toEqual(["a-retry-c"]);
        expect(
          deriveActivityData({ events: recorded }).rows.map((row) => [
            row.key,
            row.mono,
            row.tail,
          ])
        ).toEqual([
          ["discarded-c", "read_file: discarded-c", "rejected"],
          ["retry-c", "read_file: retry-c.safe", "modified"],
          ["result-c", "read_file: retry-c.safe", "terminated"],
          ["again", "read_file: next", "modified"],
        ]);
      });
    });

    it("pairs by execution only in a sample that records execution_id, and otherwise as before it", () => {
      // Bridges before inspect_ai#6370 recorded `proposal_id` but never
      // `execution_id`, so their logs keep the old rules: a run takes the
      // latest output proposing its id.
      const runs = [
        proposing("m-a", "a"),
        ...decide("call-a", "tool_call", "modify", undefined, "a.safe"),
        proposing("m-b", "b"),
        ran("t-a", kModelId, "a.safe"),
        ...decide("result-a", "tool_result", "terminate"),
      ];
      expect(views([handedOverElsewhere(), ...runs]).activity).toEqual([
        ["call-a", "read_file: a.safe", "modified"],
        ["result-a", "read_file: a.safe", "terminated"],
      ]);
      expect(views(runs).activity).toEqual([
        ["call-a", "mcp__host__read_file: a", "modified"],
        ["result-a", "mcp__host__read_file: b", "terminated"],
      ]);
    });
  });
});
