/**
 * Logs with no `execution_id` (from inspect_ai before #6370), as the
 * differential test in legacyPairing.test.ts renders them, and the projection
 * of what pairing decides that it compares. Test-only.
 */

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
  ToolCall,
} from "@tsmono/inspect-common/types";

const kSolver = "solver";
const kId = "c";

const solverBegin = testSpanBeginEvent({
  uuid: "begin:solver",
  id: kSolver,
  name: kSolver,
  type: "solver",
});

/** A native call, a bridge's host call under the model's id, or one the bridge handed its scaffold under a new id (a pre-#6370 bridge records only `proposal_id`). */
type Kind = "native" | "bridge" | "tokenized";

const call = (path: string, id = kId): ToolCall =>
  testToolCall({ id, function: "read_file", arguments: { path } });

const output = (
  uuid: string,
  calls: ToolCall[],
  { bridged = false, parent = kSolver } = {}
): Event =>
  testModelEvent({
    uuid,
    span_id: parent,
    requested_model: bridged ? "client" : undefined,
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ tool_calls: calls }),
        }),
      ],
    }),
  });

const approval = (
  uuid: string,
  path: string,
  decision: ApprovalEvent["decision"],
  { parent = kSolver, id = kId } = {}
): Event =>
  testApprovalEvent({
    uuid,
    span_id: parent,
    approver: "human",
    call: call(path, id),
    decision,
  });

const check = (
  uuid: string,
  stage: SentinelEvent["stage"],
  action: SentinelEvent["action"],
  {
    bridge = false,
    parent = kSolver,
    id = kId,
    modified,
  }: {
    bridge?: boolean;
    parent?: string;
    id?: string;
    modified?: ToolCall;
  } = {}
): Event[] => [
  testSpanBeginEvent({
    uuid: `begin:${uuid}`,
    id: uuid,
    name: bridge ? "sentinel_bridge" : "sentinel",
    type: "sentinel",
    parent_id: parent,
    span_id: parent,
  }),
  testSentinelEvent({
    uuid,
    span_id: uuid,
    conversation: parent,
    step_id: id,
    stage,
    action,
    modified,
  }),
  testSpanEndEvent({ uuid: `end:${uuid}`, id: uuid, span_id: parent }),
];

const tool = (
  uuid: string,
  path: string,
  {
    kind = "native",
    id = kId,
    parent = kSolver,
    rejected = false,
  }: { kind?: Kind; id?: string; parent?: string; rejected?: boolean } = {}
): Event =>
  testToolEvent({
    uuid,
    id,
    span_id: parent,
    function: "read_file",
    arguments: { path },
    error: rejected
      ? { type: "approval", message: "Rejected by sentinel" }
      : undefined,
    metadata:
      kind === "native"
        ? undefined
        : {
            bridge: {
              server: "host",
              tool: "read_file",
              function: "mcp__host__read_file",
              proposal_id: kId,
              grant: "consumed",
            },
          },
  });

type Review = "none" | "approve" | "reject" | "modify";
type Check = "none" | "call-modify" | "call-reject" | "result-terminate";

/** One run of a call: its approval, its checks and its ToolEvent. */
const run = (
  prefix: string,
  path: string,
  kind: Kind,
  review: Review,
  checked: Check,
  id = kId
): Event[] => {
  const bridge = kind !== "native";
  const rejected = review === "reject" || checked === "call-reject";
  const ran = checked === "call-modify" ? `${path}.safe` : path;
  return [
    ...(review === "none"
      ? []
      : [
          review === "modify"
            ? testApprovalEvent({
                uuid: `${prefix}-approval`,
                span_id: kSolver,
                approver: "human",
                call: call(path),
                decision: "modify",
                modified: call(`${path}.approved`),
              })
            : approval(`${prefix}-approval`, path, review),
        ]),
    ...(checked === "call-modify"
      ? check(`${prefix}-call`, "tool_call", "modify", {
          bridge,
          modified: call(ran),
        })
      : checked === "call-reject"
        ? check(`${prefix}-call`, "tool_call", "reject", { bridge })
        : []),
    tool(`${prefix}-tool`, ran, { kind, id, rejected }),
    ...(checked === "result-terminate"
      ? check(`${prefix}-result`, "tool_result", "terminate", { bridge })
      : []),
  ];
};

const kKinds: Kind[] = ["native", "bridge", "tokenized"];
const kReviews: Review[] = ["none", "approve", "reject", "modify"];
const kChecks: Check[] = [
  "none",
  "call-modify",
  "call-reject",
  "result-terminate",
];

export interface LegacyFixture {
  name: string;
  events: Event[];
}

const stamp = (events: Event[]): Event[] =>
  [solverBegin, ...events].map((event, i) => ({
    ...event,
    timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  }));

const fixture = (name: string, events: Event[]): LegacyFixture => ({
  name,
  events: stamp(events),
});

/** A tokenized second run keeps the model's id for its first run, as a bridge hands only a repeat over under a new id. */
const secondId = (kind: Kind) => (kind === "tokenized" ? "tok" : kId);

const matrix = (): LegacyFixture[] =>
  kKinds.flatMap((kind) =>
    kReviews.flatMap((review) =>
      kChecks.flatMap((checked) => {
        const bridged = kind !== "native";
        const tag = `${kind} / ${review} approval / ${checked}`;
        return [
          fixture(`single run: ${tag}`, [
            output("m1", [call("a")], { bridged }),
            ...run("r1", "a", kind, review, checked, secondId(kind)),
          ]),
          fixture(`sequential turns reusing the id: ${tag}`, [
            output("m1", [call("a")], { bridged }),
            ...run("r1", "a", kind, review, checked),
            output("m2", [call("b")], { bridged }),
            ...run("r2", "b", kind, review, checked, secondId(kind)),
          ]),
          fixture(`one output proposing the id twice: ${tag}`, [
            output("m1", [call("a"), call("b")], { bridged }),
            ...run("r1", "a", kind, review, checked),
            ...run("r2", "b", kind, review, checked, secondId(kind)),
          ]),
          fixture(`a later output arriving before the run: ${tag}`, [
            output("m1", [call("a")], { bridged }),
            output("m2", [call("b")], { bridged }),
            ...run("r1", "a", kind, review, checked),
            ...run("r2", "b", kind, review, checked, secondId(kind)),
          ]),
        ];
      })
    )
  );

/** A native and a bridge check of one id, both before either run, in each run order (round 7's shared-model-id shape, without `execution_id`). */
const arrivalOrders = (): LegacyFixture[] =>
  (["modify", "reject"] as const).flatMap((action) =>
    [true, false].map((hostFirst) => {
      const native = tool("t-native", action === "modify" ? "a.safe" : "a", {
        rejected: action === "reject",
      });
      const host = tool("t-host", "b.safe", { kind: "tokenized", id: "tok" });
      return fixture(
        `native ${action} and bridge checks before both runs, ${hostFirst ? "host" : "native"} run first`,
        [
          output("warmup", [call("old")], { bridged: true }),
          tool("t-old", "old", { kind: "bridge" }),
          output("m", [call("a"), call("b")], { bridged: true }),
          ...check(
            "native-call",
            "tool_call",
            action,
            action === "modify" ? { modified: call("a.safe") } : {}
          ),
          ...check("bridge-call", "tool_call", "modify", {
            bridge: true,
            modified: call("b.safe"),
          }),
          ...(hostFirst ? [host, native] : [native, host]),
        ]
      );
    })
  );

const agent = (id: string, parent = kSolver): Event =>
  testSpanBeginEvent({
    uuid: `begin:${id}`,
    id,
    name: id,
    type: "agent",
    parent_id: parent,
    span_id: parent,
  });

const agentEnd = (id: string, parent = kSolver): Event =>
  testSpanEndEvent({ uuid: `end:${id}`, id, span_id: parent });

/** Agents and monitors that reuse an agent's call id, which the new rules scope by conversation and sentinel span. */
const scoping = (): LegacyFixture[] => [
  fixture("sibling agents in parallel proposing one id", [
    agent("alpha"),
    agent("beta"),
    output("m-alpha", [call("a")], { parent: "alpha" }),
    output("m-beta", [call("b")], { parent: "beta" }),
    approval("ap-alpha", "a", "approve", { parent: "alpha" }),
    approval("ap-beta", "b", "reject", { parent: "beta" }),
    ...check("call-alpha", "tool_call", "modify", {
      parent: "alpha",
      modified: call("a.safe"),
    }),
    tool("t-beta", "b", { parent: "beta", rejected: true }),
    tool("t-alpha", "a.safe", { parent: "alpha" }),
    ...check("result-alpha", "tool_result", "terminate", { parent: "alpha" }),
    agentEnd("alpha"),
    agentEnd("beta"),
  ]),
  fixture("a delegated agent proposing its parent's id", [
    agent("parent"),
    output("m-parent", [call("a")], { parent: "parent" }),
    approval("ap-parent", "a", "approve", { parent: "parent" }),
    ...check("call-parent", "tool_call", "modify", {
      parent: "parent",
      modified: call("a.safe"),
    }),
    agent("child", "parent"),
    output("m-child", [call("b")], { parent: "child" }),
    tool("t-child", "b", { parent: "child" }),
    agentEnd("child", "parent"),
    tool("t-parent", "a.safe", { parent: "parent" }),
    agentEnd("parent"),
  ]),
  fixture("a monitor's own call under the agent's id", [
    output("m", [call("a")]),
    approval("ap-agent", "a", "approve"),
    testSpanBeginEvent({
      uuid: "begin:monitor",
      id: "monitor",
      name: "sentinel",
      type: "sentinel",
      parent_id: kSolver,
      span_id: kSolver,
    }),
    output("m-monitor", [call("probe")], { parent: "monitor" }),
    approval("ap-monitor", "probe", "approve", { parent: "monitor" }),
    tool("t-monitor", "probe", { parent: "monitor" }),
    testSentinelEvent({
      uuid: "monitor-check",
      span_id: "monitor",
      conversation: kSolver,
      step_id: kId,
      stage: "tool_call",
      action: "modify",
      modified: call("a.safe"),
    }),
    testSpanEndEvent({ uuid: "end:monitor", id: "monitor", span_id: kSolver }),
    tool("t-agent", "a.safe"),
  ]),
  fixture("a bridge check rejected, then retried under the same id", [
    output("m1", [call("a")], { bridged: true }),
    ...check("call-1", "tool_call", "reject", { bridge: true }),
    output("m2", [call("a2")], { bridged: true }),
    ...check("call-2", "tool_call", "proceed", { bridge: true }),
    tool("t-2", "a2", { kind: "bridge" }),
    ...check("result-2", "tool_result", "terminate", { bridge: true }),
  ]),
  fixture("a bridge's own call its scaffold ran, with no ToolEvent", [
    output("m1", [call("a")], { bridged: true }),
    ...check("call-own", "tool_call", "modify", {
      bridge: true,
      modified: call("a.safe"),
    }),
    output("m2", [call("b", "d")]),
    tool("t-d", "b", { id: "d" }),
  ]),
];

/** Every legacy fixture, by unique name. */
export const legacyFixtures = (): LegacyFixture[] => [
  ...matrix(),
  ...arrivalOrders(),
  ...scoping(),
];

interface Step {
  id: string;
}

type ActivityRow = Partial<
  Record<(typeof kRowFields)[number], string | number>
>;

/** What the projection reads of a revision, over its own node type `N`. */
export interface PairingLib<N> {
  treeifyEvents: (events: Event[], depth: number) => N[];
  pairToolSentinels: (nodes: N[]) => {
    toolSentinels: Map<
      string,
      { before?: Step; after?: Step; proposed?: ToolCall }
    >;
    standaloneSentinels: Map<string, Step>;
    hiddenSentinelIds: Set<string>;
    sentinelScrollRedirects: Map<string, string>;
  };
  pairToolApprovals: (nodes: N[]) => {
    toolApprovals: Map<string, { id: string }[]>;
    hiddenApprovalIds: Set<string>;
    approvalScrollRedirects: Map<string, string>;
  };
  deriveActivityData: (inputs: { events: Event[] }) => {
    rows: ActivityRow[];
    turns: {
      index: number;
      rowId: string;
      model?: { uuid?: string };
      tools: { uuid?: string; failed: boolean }[];
      rejected: number;
    }[];
    rejectedCount: number;
  };
}

const byKey = <V>(map: Map<string, V>): [string, V][] =>
  [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const callText = (call: ToolCall | undefined): string =>
  call ? `${call.function}${JSON.stringify(call.arguments)}` : "-";

const kRowFields = [
  "key",
  "uuid",
  "time",
  "category",
  "kind",
  "lead",
  "mono",
  "tail",
  "detail",
  "by",
  "byRole",
] as const;

/** Every field a row may carry, in a fixed order; one it lacks reads "-". */
const rowText = (row: ActivityRow): string =>
  kRowFields.map((field) => String(row[field] ?? "-")).join(" | ");

/**
 * Everything pairing decides for a sample, one fact per line: each tool's
 * steps, proposal and approvals, which events hide and where navigation to
 * them lands, and the Activity view's rows and turns. `lib` is either
 * revision's implementation, so output recorded from one compares with the
 * other.
 */
export const projectPairing = <N>(
  lib: PairingLib<N>,
  events: Event[]
): string[] => {
  const nodes = lib.treeifyEvents(events, 0);
  const sentinels = lib.pairToolSentinels(nodes);
  const approvals = lib.pairToolApprovals(nodes);
  const activity = lib.deriveActivityData({ events });
  const redirects = new Map([
    ...byKey(sentinels.sentinelScrollRedirects),
    ...byKey(approvals.approvalScrollRedirects),
  ]);
  const hidden = [
    ...sentinels.hiddenSentinelIds,
    ...approvals.hiddenApprovalIds,
  ].sort();
  return [
    ...byKey(sentinels.toolSentinels).map(
      ([id, paired]) =>
        `tool ${id} before=${paired.before?.id ?? "-"} after=${paired.after?.id ?? "-"} proposed=${callText(paired.proposed)}`
    ),
    ...byKey(sentinels.standaloneSentinels).map(
      ([id, step]) => `standalone ${id} step=${step.id}`
    ),
    ...byKey(approvals.toolApprovals).map(
      ([id, chain]) =>
        `approvals ${id}: ${chain.map((node) => node.id).join(" ")}`
    ),
    ...hidden.map((id) => `hidden ${id} -> ${redirects.get(id) ?? "-"}`),
    ...activity.rows.map((row) => `row ${rowText(row)}`),
    ...activity.turns.map(
      (turn) =>
        `turn ${turn.index} ${turn.rowId} model=${turn.model?.uuid ?? "-"} rejected=${turn.rejected} tools=${turn.tools
          .map((span) => `${span.uuid ?? "?"}${span.failed ? "!" : ""}`)
          .join(" ")}`
    ),
    `rejected ${activity.rejectedCount}`,
  ];
};
