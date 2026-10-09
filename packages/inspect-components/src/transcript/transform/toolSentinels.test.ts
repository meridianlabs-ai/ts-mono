import { describe, expect, it } from "vitest";

import {
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
  Event,
  SentinelEvent,
  ToolCall,
} from "@tsmono/inspect-common/types";

import { EventNode } from "../types";

import {
  buildLoneSentinelStep,
  buildSentinelStep,
  formatSuspicion,
  pairToolSentinels,
  topScore,
  type SentinelNode,
  type SentinelStep,
} from "./toolSentinels";
import { treeifyEvents } from "./treeify";

const sentinel = (
  id: string,
  overrides: Partial<SentinelEvent> = {}
): SentinelNode => new EventNode(id, testSentinelEvent(overrides), 0);

const decision = (
  id: string,
  path: string,
  name: string,
  action: NonNullable<SentinelEvent["action"]>
): SentinelNode =>
  sentinel(id, {
    path,
    factory: name,
    function: name,
    kind: "decision",
    action,
  });

const layer = (
  id: string,
  path: string,
  name: string,
  status: "bypassed" | "cancelled"
): SentinelNode =>
  sentinel(id, {
    path,
    factory: name,
    status,
    function: null,
    action: null,
  });

const failed = (id: string, path: string, name: string): SentinelNode =>
  sentinel(id, {
    path,
    factory: name,
    function: name,
    kind: "observation",
    status: "error",
    action: null,
    error: "ValueError: no model",
  });

const observation = (
  id: string,
  path: string,
  name: string,
  suspicion: NonNullable<SentinelEvent["suspicion"]>
): SentinelNode =>
  sentinel(id, {
    path,
    factory: name,
    function: "score",
    kind: "observation",
    suspicion,
    action: null,
  });

const rowIds = (step: SentinelStep) => step.rows.map((r) => r.node.id);

describe("buildSentinelStep", () => {
  const withExplanation = (node: SentinelNode, explanation: string) => {
    node.event.explanation = explanation;
    return node;
  };

  it("orders checks as a tree with guides and depth", () => {
    const step = buildSentinelStep([
      decision("net", "guard/network", "no_network", "continue"),
      decision("prot", "guard/protected", "protected", "continue"),
      observation("mon", "guard/llm/monitor", "llm_suspicion", 0.2),
      decision("llm", "guard/llm", "threshold", "continue"),
      decision("guard", "guard", "sequential", "continue"),
      observation("scope", "scope", "suspicion", 0.4),
      decision("root", "", "concurrent", "continue"),
    ]);
    expect(rowIds(step)).toEqual([
      "root",
      "guard",
      "net",
      "prot",
      "llm",
      "mon",
      "scope",
    ]);
    expect(step.rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 2, 3, 1]);
    expect(step.rows.map((r) => r.guides)).toEqual([
      "",
      "├─ ",
      "│  ├─ ",
      "│  ├─ ",
      "│  └─ ",
      "│     └─ ",
      "└─ ",
    ]);
  });

  it("keeps a top-level row that repeats its single child", () => {
    const step = buildSentinelStep([
      decision("rule", "no_network", "no_network", "reject"),
      decision("root", "", "concurrent", "reject"),
    ]);
    expect(rowIds(step)).toEqual(["root", "rule"]);
    expect(step.rows).toHaveLength(2);
  });

  it("marks the lowest matching descendant of the top decision as taking effect", () => {
    const step = buildSentinelStep([
      decision("net", "guard/network", "no_network", "continue"),
      withExplanation(
        decision("llm", "guard/llm", "threshold", "reject"),
        "exfiltration 0.93 is over the 0.80 threshold."
      ),
      decision("guard", "guard", "sequential", "reject"),
      decision("root", "", "concurrent", "reject"),
    ]);
    expect(step.verdict).toBe("reject");
    expect(step.effective?.id).toBe("llm");
    expect(step.decider?.id).toBe("llm");
    expect(step.rows.filter((r) => r.tookEffect).map((r) => r.node.id)).toEqual(
      ["llm"]
    );
    expect(step.reason).toBe("exfiltration 0.93 is over the 0.80 threshold.");
  });

  it("credits the child whose explanation the parent passed up among several that made the decision", () => {
    const step = buildSentinelStep([
      decision("c", "c", "rule", "continue"),
      withExplanation(decision("a", "a", "rule", "reject"), "first"),
      withExplanation(decision("b", "b", "rule", "reject"), "second"),
      withExplanation(decision("root", "", "concurrent", "reject"), "second"),
    ]);
    expect(step.effective?.id).toBe("b");
    expect(step.reason).toBe("second");
  });

  it("credits a concurrent tie by explanation when children completed out of configuration order", () => {
    // `concurrent` takes the first reject in configuration order (a), but
    // children record as they complete, so b is recorded first.
    const step = buildSentinelStep([
      withExplanation(decision("b", "b", "rule", "reject"), "Too slow."),
      withExplanation(decision("a", "a", "rule", "reject"), "Too risky."),
      withExplanation(
        decision("root", "", "concurrent", "reject"),
        "Too risky. (a: reject; b: reject)"
      ),
    ]);
    expect(step.effective?.id).toBe("a");
    expect(step.reason).toBe("Too risky.");
  });

  it("credits the parent of a tie its explanation does not settle", () => {
    const step = buildSentinelStep([
      withExplanation(decision("a", "a", "rule", "reject"), "Too risky."),
      withExplanation(decision("b", "b", "rule", "reject"), "Too risky."),
      withExplanation(decision("root", "", "sequential", "reject"), "No."),
    ]);
    expect(step.effective?.id).toBe("root");
    expect(step.reason).toBe("No.");
    expect(step.rows.filter((r) => r.tookEffect).map((r) => r.node.id)).toEqual(
      ["root"]
    );
  });

  it("credits the parent of a tie when it has no explanation", () => {
    const step = buildSentinelStep([
      withExplanation(decision("a", "a", "rule", "escalate"), "first"),
      withExplanation(decision("b", "b", "rule", "escalate"), "second"),
      decision("root", "", "sequential", "escalate"),
    ]);
    expect(step.effective?.id).toBe("root");
    expect(step.reason).toBeUndefined();
  });

  it("links the summary reason to the references of the check it comes from", () => {
    const rule = withExplanation(
      decision("rule", "rule", "rule", "reject"),
      "See [M2]."
    );
    rule.event.references = [{ type: "message", id: "msg_2", cite: "[M2]" }];
    const step = buildSentinelStep([
      rule,
      decision("root", "", "concurrent", "reject"),
    ]);
    expect(step.reason).toBe("See [M2].");
    expect(step.reasonReferences.map((r) => r.id)).toEqual(["msg_2"]);
  });

  it("credits a child whose parent reworded its reject, with the child's reason", () => {
    const step = buildSentinelStep([
      withExplanation(decision("rule", "rule", "rule", "reject"), "child"),
      withExplanation(decision("root", "", "concurrent", "reject"), "parent"),
    ]);
    expect(step.effective?.id).toBe("rule");
    expect(step.reason).toBe("child");
  });

  it("credits the lowest check under a rewording concurrent layer", () => {
    const rewritten =
      "`curl` needs the network, which this task does not allow. (network: reject; protected: continue)";
    const step = buildSentinelStep([
      withExplanation(
        decision("net", "guard/network", "no_network", "reject"),
        "`curl` needs the network, which this task does not allow."
      ),
      decision("prot", "guard/protected", "protected", "continue"),
      withExplanation(
        decision("guard", "guard", "concurrent", "reject"),
        rewritten
      ),
      observation("audit", "audit", "suspicion", 0.2),
      withExplanation(decision("root", "", "concurrent", "reject"), rewritten),
    ]);
    expect(step.outcome?.id).toBe("root");
    expect(step.effective?.id).toBe("net");
    expect(step.decider?.event.path).toBe("guard/network");
    expect(step.reason).toBe(
      "`curl` needs the network, which this task does not allow."
    );
  });

  it("follows a passed-up decision through a layer with no explanation", () => {
    const step = buildSentinelStep([
      withExplanation(decision("llm", "guard/llm", "threshold", "reject"), "x"),
      decision("guard", "guard", "sequential", "reject"),
      withExplanation(decision("root", "", "concurrent", "reject"), "x"),
    ]);
    expect(step.effective?.id).toBe("llm");
  });

  it("credits a child that proposed a different modify, keeping the call the root ran", () => {
    const modify = (id: string, path: string, cmd: string) => {
      const node = decision(id, path, id, "modify");
      node.event.modified = testToolCall({ arguments: { cmd } });
      return node;
    };
    const step = buildSentinelStep([
      modify("rule", "rule", "CHILD_CMD"),
      modify("root", "", "ROOT_CMD"),
    ]);
    expect(step.effective?.id).toBe("rule");
    expect(step.outcome?.event.modified?.arguments).toEqual({
      cmd: "ROOT_CMD",
    });
  });

  it("falls back to the top decision's explanation", () => {
    const step = buildSentinelStep([
      decision("rule", "rule", "rule", "reject"),
      withExplanation(decision("root", "", "concurrent", "reject"), "why"),
    ]);
    expect(step.effective?.id).toBe("rule");
    expect(step.reason).toBe("why");
  });

  it("takes the decide_final() decision recorded after the bypassed root", () => {
    const step = buildSentinelStep([
      decision("net", "guard/network", "no_network", "reject"),
      layer("guard", "guard", "concurrent", "bypassed"),
      layer("audit", "audit", "suspicion", "cancelled"),
      layer("root", "", "concurrent", "bypassed"),
      decision("prot", "guard/protected", "protected", "reject"),
    ]);
    expect(step.rows).toHaveLength(5);
    expect(step.verdict).toBe("reject");
    expect(step.outcome?.id).toBe("prot");
    expect(step.effective?.id).toBe("prot");
    expect(rowIds(step)).toEqual(["root", "guard", "net", "prot", "audit"]);
  });

  it("descends below a decide_final() origin into a child that made its decision", () => {
    const step = buildSentinelStep([
      decision("quiet", "guard/quiet", "rule", "continue"),
      withExplanation(decision("inner", "guard/inner", "rule", "reject"), "a"),
      layer("root", "", "concurrent", "bypassed"),
      withExplanation(decision("guard", "guard", "strict", "reject"), "b"),
    ]);
    expect(step.outcome?.id).toBe("guard");
    expect(step.effective?.id).toBe("inner");
    expect(step.reason).toBe("a");
  });

  it("takes the reason from the nearest explained check above an unexplained one", () => {
    const step = buildSentinelStep([
      decision("rule", "guard/rule", "rule", "reject"),
      withExplanation(decision("guard", "guard", "sequential", "reject"), "g"),
      withExplanation(decision("root", "", "concurrent", "reject"), "r"),
    ]);
    expect(step.effective?.id).toBe("rule");
    expect(step.reason).toBe("g");
  });

  it("reads a step whose root returned nothing as continued, whatever a child decided", () => {
    const step = buildSentinelStep([
      withExplanation(decision("rule", "rule", "rule", "reject"), "no"),
      observation("mon", "monitor", "suspicion", 0.3),
    ]);
    expect(step.verdict).toBe("continue");
    expect(step.outcome).toBeUndefined();
    expect(step.effective).toBeUndefined();
    expect(step.reason).toBeUndefined();
    expect(step.scores).toEqual(["suspicion 0.3"]);
  });

  it("names the kind of a step whose every check was cancelled", () => {
    const step = buildSentinelStep([
      layer("a", "a", "slow", "cancelled"),
      layer("root", "", "concurrent", "cancelled"),
    ]);
    expect(step.verdict).toBe("cancelled");
  });

  it("gives an event shown alone its own result", () => {
    expect(
      buildLoneSentinelStep(layer("guard", "guard", "concurrent", "bypassed"))
        .verdict
    ).toBe("bypassed");
    const lone = buildLoneSentinelStep(
      decision("rule", "guard/rule", "rule", "reject")
    );
    expect(lone.verdict).toBe("reject");
    expect(lone.effective?.id).toBe("rule");
  });

  it("gives a superseded decision one row carried by the superseded event", () => {
    const step = buildSentinelStep([
      decision("esc", "review", "escalate_on_doubt", "escalate"),
      sentinel("sup", {
        path: "review",
        factory: "escalate_on_doubt",
        function: "escalate_on_doubt",
        status: "superseded",
        action: "escalate",
      }),
      decision("root", "", "concurrent", "continue"),
    ]);
    expect(rowIds(step)).toEqual(["root", "sup"]);
    expect(step.verdict).toBe("continue");
    expect(step.effective).toBeUndefined();
  });

  it("takes the final record after a superseded decision and the bypassed layers", () => {
    // A decide_final() that overrode an earlier veto: the cancelled layers,
    // the superseded veto, the bypassed root, then the decision that ran.
    const superseded = sentinel("backup", {
      path: "veto_backup",
      factory: "hard_veto",
      function: "decide",
      status: "superseded",
      action: "reject",
      message: "Blocked (veto_backup).",
      explanation: "veto_backup: never allowed.",
    });
    const final = withExplanation(
      decision("veto", "veto", "hard_veto", "reject"),
      "veto: never allowed."
    );
    final.event.message = "Blocked (veto).";
    const step = buildSentinelStep([
      decision("policy", "policy", "always_continue", "continue"),
      decision("triage", "gate/triage", "triage", "escalate"),
      observation("history", "audit/history", "history_watch", 0.4),
      layer("gate", "gate", "inspect_sentinel/sequential", "cancelled"),
      layer("slow", "audit/slow_audit", "fixed_score", "cancelled"),
      layer("audit", "audit", "inspect_sentinel/observe_only", "cancelled"),
      superseded,
      layer("root", "", "inspect_sentinel/concurrent", "bypassed"),
      final,
    ]);
    expect(step.verdict).toBe("reject");
    expect(step.outcome?.id).toBe("veto");
    expect(step.effective?.id).toBe("veto");
    expect(step.reason).toBe("veto: never allowed.");
    expect(rowIds(step)).toEqual([
      "root",
      "policy",
      "gate",
      "triage",
      "audit",
      "history",
      "slow",
      "backup",
      "veto",
    ]);
    expect(step.rows.filter((r) => r.tookEffect).map((r) => r.node.id)).toEqual(
      ["veto"]
    );
  });

  it("marks nothing as taking effect when every check continued", () => {
    const step = buildSentinelStep([
      decision("rule", "guard", "rule", "continue"),
      observation("mon", "scope", "suspicion", 0.15),
      decision("root", "", "concurrent", "continue"),
    ]);
    expect(step.verdict).toBe("continue");
    expect(step.effective).toBeUndefined();
    expect(step.rows.some((r) => r.tookEffect)).toBe(false);
    expect(step.decider?.id).toBe("root");
    expect(step.scores).toEqual(["suspicion 0.15"]);
    expect(step.reason).toBeUndefined();
  });

  it("calls a step with no decision observed", () => {
    const step = buildSentinelStep([
      observation("mon", "monitor", "llm_suspicion", {
        sabotage: 0.05,
        exfiltration: 0.08,
      }),
      observation("fail", "failures", "observe/failure_count", 0.2),
    ]);
    expect(step.verdict).toBe("observe");
    expect(step.scores).toEqual(["exfiltration 0.08", "failure_count 0.2"]);
  });

  it("calls an explicit root continue continued, with the monitors' scores", () => {
    const step = buildSentinelStep([
      observation("mon", "monitor", "llm_suspicion", {
        sabotage: 0.05,
        exfiltration: 0.62,
      }),
      decision("root", "", "threshold", "continue"),
    ]);
    expect(step.verdict).toBe("continue");
    expect(step.decider?.id).toBe("root");
    expect(step.scores).toEqual(["exfiltration 0.62"]);
  });

  it("skips an observation with no scores", () => {
    const step = buildSentinelStep([
      observation("mon", "monitor", "llm_suspicion", {}),
      decision("root", "", "threshold", "continue"),
    ]);
    expect(step.scores).toEqual([]);
  });

  it("summarises a lone observation with its full suspicion and explanation", () => {
    const step = buildSentinelStep([
      withExplanation(
        observation("fail", "observe/failure_count", "failure_count", 0.2),
        "1 earlier calls failed"
      ),
    ]);
    expect(step.verdict).toBe("observe");
    expect(step.scores).toEqual(["0.2"]);
    expect(step.reason).toBe("1 earlier calls failed");
  });

  it("counts failed monitors without letting them decide the verdict", () => {
    const step = buildSentinelStep([
      failed("broken", "broken", "llm_suspicion"),
      observation("mon", "monitor", "m", 0.3),
      decision("root", "", "concurrent", "continue"),
    ]);
    expect(step.verdict).toBe("continue");
    expect(step.failed).toBe(1);
    expect(step.rows.map((r) => r.node.id)).toEqual(["root", "broken", "mon"]);
  });

  it("calls a step whose only check failed failed, with its error", () => {
    const step = buildSentinelStep([failed("broken", "broken", "m")]);
    expect(step.verdict).toBe("error");
    expect(step.error).toBe("ValueError: no model");
    expect(step.reason).toBeUndefined();
    expect(step.scores).toEqual([]);
  });

  it("marks a root escalate as the runner's, and a lone child escalate as not", () => {
    const root = buildSentinelStep([
      decision("rule", "rule", "rule", "escalate"),
      decision("root", "", "concurrent", "escalate"),
    ]);
    expect(root.verdict).toBe("escalate");
    expect(root.returned).toBe(true);
    const lone = buildLoneSentinelStep(
      decision("rule", "rule", "rule", "escalate")
    );
    expect(lone.verdict).toBe("escalate");
    expect(lone.returned).toBe(false);
  });

  it("flags a step when any event asks for an audit", () => {
    const flagged = observation("mon", "monitor", "m", 0.9);
    flagged.event.audit = true;
    const step = buildSentinelStep([
      flagged,
      decision("root", "", "concurrent", "continue"),
    ]);
    expect(step.audit).toBe(true);
  });
});

describe("topScore", () => {
  it("picks the highest score and counts the rest", () => {
    expect(
      topScore({ sabotage: 0.1, exfiltration: 0.934, other: 0.2 })
    ).toEqual({ dimension: "exfiltration", value: "0.93", more: 2 });
    expect(topScore(0.41)).toEqual({ value: "0.41", more: 0 });
  });

  it("gives an empty suspicion an empty value", () => {
    expect(topScore({})).toEqual({ value: "", more: 0 });
  });
});

describe("pairToolSentinels", () => {
  const tool = (id: string, callId: string) =>
    new EventNode(id, testToolEvent({ id: callId }), 0);
  const span = (id: string, children: EventNode[]) => {
    const node = new EventNode(
      id,
      testSpanBeginEvent({ id, name: "sentinel", type: "sentinel" }),
      0
    );
    node.children = children;
    return node;
  };

  it("pairs parallel calls whose spans and tools interleave", () => {
    const result = pairToolSentinels([
      span("span-a", [
        sentinel("a", { step_id: "call_a", action: "continue" }),
      ]),
      span("span-b", [sentinel("b", { step_id: "call_b", action: "reject" })]),
      tool("tool-b", "call_b"),
      tool("tool-a", "call_a"),
    ]);
    expect(result.toolSentinels.get("tool-a")?.before?.verdict).toBe(
      "continue"
    );
    expect(result.toolSentinels.get("tool-b")?.before?.verdict).toBe("reject");
    expect(result.sentinelScrollRedirects.get("span-a")).toBe("tool-a");
    expect(result.sentinelScrollRedirects.get("b")).toBe("tool-b");
  });

  it("keeps steps apart when calls repeat a tool call id", () => {
    const result = pairToolSentinels([
      span("span-1", [sentinel("s1", { step_id: "dup", action: "continue" })]),
      tool("tool-1", "dup"),
      span("span-2", [sentinel("s2", { step_id: "dup", action: "reject" })]),
      tool("tool-2", "dup"),
    ]);
    const first = result.toolSentinels.get("tool-1")?.before;
    const second = result.toolSentinels.get("tool-2")?.before;
    expect(first && rowIds(first)).toEqual(["s1"]);
    expect(second && rowIds(second)).toEqual(["s2"]);
    expect(second?.verdict).toBe("reject");
  });

  it("gives a tool the call the model proposed before it", () => {
    const proposal = (id: string, cmd: string) =>
      new EventNode(
        id,
        testModelEvent({
          output: testModelOutput({
            choices: [
              testChatCompletionChoice({
                message: testAssistantMessage({
                  tool_calls: [testToolCall({ id: "dup", arguments: { cmd } })],
                }),
              }),
            ],
          }),
        }),
        0
      );
    const result = pairToolSentinels([
      proposal("m1", "FIRST"),
      span("span-1", [sentinel("s1", { step_id: "dup" })]),
      tool("tool-1", "dup"),
      proposal("m2", "SECOND"),
      span("span-2", [sentinel("s2", { step_id: "dup" })]),
      tool("tool-2", "dup"),
    ]);
    expect(result.toolSentinels.get("tool-1")?.proposed?.arguments).toEqual({
      cmd: "FIRST",
    });
    expect(result.toolSentinels.get("tool-2")?.proposed?.arguments).toEqual({
      cmd: "SECOND",
    });
  });

  it("gives calls that share an id in one model output their proposals in order", () => {
    const output = new EventNode(
      "m1",
      testModelEvent({
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({
                tool_calls: [
                  testToolCall({ id: "dup", arguments: { cmd: "FIRST" } }),
                  testToolCall({ id: "dup", arguments: { cmd: "SECOND" } }),
                ],
              }),
            }),
          ],
        }),
      }),
      0
    );
    const result = pairToolSentinels([
      output,
      span("span-1", [sentinel("s1", { step_id: "dup" })]),
      tool("tool-1", "dup"),
      span("span-2", [sentinel("s2", { step_id: "dup" })]),
      tool("tool-2", "dup"),
    ]);
    expect(result.toolSentinels.get("tool-1")?.proposed?.arguments).toEqual({
      cmd: "FIRST",
    });
    expect(result.toolSentinels.get("tool-2")?.proposed?.arguments).toEqual({
      cmd: "SECOND",
    });
  });

  it("leaves a before-call step standalone when no tool with its id follows it", () => {
    const result = pairToolSentinels([
      tool("tool-1", "dup"),
      span("span-1", [sentinel("s1", { step_id: "dup", action: "reject" })]),
    ]);
    expect(result.toolSentinels.size).toBe(0);
    expect(result.standaloneSentinels.get("span-1")?.verdict).toBe("reject");
  });

  it("pairs call and result stages with their tool and hides every event", () => {
    const before = decision("before", "", "protocol", "continue");
    const after = sentinel("after", {
      stage: "tool_result",
      kind: "observation",
      suspicion: { exfiltration: 0.2 },
      action: null,
    });
    const result = pairToolSentinels([before, tool("tool-1", "call_1"), after]);

    const paired = result.toolSentinels.get("tool-1");
    expect(paired?.before && rowIds(paired.before)).toEqual(["before"]);
    expect(paired?.after && rowIds(paired.after)).toEqual(["after"]);
    expect([...result.hiddenSentinelIds]).toEqual(["before", "after"]);
    expect(result.sentinelScrollRedirects.get("after")).toBe("tool-1");
    expect(result.standaloneSentinels.size).toBe(0);
  });

  it("finds tools and events across nested children once each", () => {
    const toolNode = tool("tool-1", "call_1");
    const event = decision("before", "", "protocol", "continue");
    const agent = new EventNode(
      "agent",
      testSpanBeginEvent({ id: "agent", type: "agent" }),
      0
    );
    agent.children = [event, toolNode];
    // Flat lists carry descendants both nested and as their own entries.
    const result = pairToolSentinels([agent, event, toolNode]);
    expect(
      result.toolSentinels.get("tool-1")?.before?.rows.map((r) => r.node.id)
    ).toEqual(["before"]);
  });

  it("hosts a step with no tool at its first event and hides the rest", () => {
    const first = sentinel("m1", {
      stage: "model_output",
      step_id: "msg_1",
      path: "monitor",
      kind: "observation",
      suspicion: 0.4,
      action: null,
    });
    const second = sentinel("m2", {
      stage: "model_output",
      step_id: "msg_1",
    });
    const result = pairToolSentinels([first, second]);

    expect(result.standaloneSentinels.get("m1")?.rows).toHaveLength(2);
    expect([...result.hiddenSentinelIds]).toEqual(["m2"]);
    expect(result.sentinelScrollRedirects.get("m2")).toBe("m1");
  });

  it("keeps tool-stage steps whose tool is missing as standalone rows", () => {
    const result = pairToolSentinels([
      decision("orphan", "", "protocol", "reject"),
    ]);
    expect(result.toolSentinels.size).toBe(0);
    expect(result.standaloneSentinels.has("orphan")).toBe(true);
    expect(result.hiddenSentinelIds.size).toBe(0);
  });
});

describe("pairToolSentinels with sentinel spans", () => {
  const tool = (id: string, callId: string) =>
    new EventNode(id, testToolEvent({ id: callId }), 0);
  const sentinelSpan = (id: string, children: EventNode[]) => {
    const span = new EventNode(
      id,
      testSpanBeginEvent({ id, name: "sentinel", type: "sentinel" }),
      0
    );
    span.children = children;
    return span;
  };
  const monitorCall = (id: string) =>
    new EventNode(id, testModelEvent({ role: "monitor" }), 1);

  it("gives a step the model calls in its span and hides the span", () => {
    const calls = [monitorCall("mc-1"), monitorCall("mc-2")];
    const report = decision("before", "", "protocol", "continue");
    const span = sentinelSpan("span-1", [...calls, report]);
    const result = pairToolSentinels([span, tool("tool-1", "call_1")]);

    const before = result.toolSentinels.get("tool-1")?.before;
    expect(before?.modelCalls.map((n) => n.id)).toEqual(["mc-1", "mc-2"]);
    expect([...result.hiddenSentinelIds].sort()).toEqual(
      ["before", "mc-1", "mc-2", "span-1"].sort()
    );
    expect(result.sentinelScrollRedirects.get("mc-1")).toBe("tool-1");
  });

  it("finds span members once each in a flat list", () => {
    const call = monitorCall("mc-1");
    const report = decision("before", "", "protocol", "continue");
    const span = sentinelSpan("span-1", [call, report]);
    const result = pairToolSentinels([
      span,
      call,
      report,
      tool("tool-1", "call_1"),
    ]);
    expect(
      result.toolSentinels.get("tool-1")?.before?.modelCalls.map((n) => n.id)
    ).toEqual(["mc-1"]);
  });

  it("hosts a step with no tool at its span", () => {
    const report = sentinel("m1", { stage: "model_output", step_id: "msg_1" });
    const span = sentinelSpan("span-1", [monitorCall("mc-1"), report]);
    const result = pairToolSentinels([span]);
    expect(result.standaloneSentinels.get("span-1")?.modelCalls).toHaveLength(
      1
    );
    expect(result.hiddenSentinelIds.has("span-1")).toBe(false);
    expect(result.sentinelScrollRedirects.get("m1")).toBe("span-1");
  });

  it("leaves a span with no sentinel event visible", () => {
    const span = sentinelSpan("span-1", [monitorCall("mc-1")]);
    const result = pairToolSentinels([span, tool("tool-1", "call_1")]);
    expect(result.hiddenSentinelIds.size).toBe(0);
    expect(result.toolSentinels.size).toBe(0);
  });
});

describe("formatSuspicion", () => {
  it("rounds a single score and lists dimensions", () => {
    expect(formatSuspicion(0.123456)).toBe("0.12");
    expect(formatSuspicion({ exfiltration: 0.9, sabotage: 0.05 })).toBe(
      "exfiltration 0.9, sabotage 0.05"
    );
  });
});

describe("pairToolSentinels on a sub-agent run as a tool", () => {
  // The event shape of an `as_tool` sub-agent: the outer call's checks sit
  // beside its tool span, and the sub-agent's calls and their checks nest
  // inside that span.
  const events: Event[] = [];
  const begin = (id: string, type: string, parent?: string) =>
    events.push(
      testSpanBeginEvent({
        id,
        uuid: id,
        name: type,
        type,
        parent_id: parent ?? null,
      })
    );
  const end = (id: string) =>
    events.push(testSpanEndEvent({ id, uuid: `${id}-end` }));
  const propose = (uuid: string, spanId: string, calls: ToolCall[]) =>
    events.push(
      testModelEvent({
        uuid,
        span_id: spanId,
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({ tool_calls: calls }),
            }),
          ],
        }),
      })
    );
  const checks = (
    spanId: string,
    parent: string,
    stepId: string,
    stage: SentinelEvent["stage"],
    action?: NonNullable<SentinelEvent["action"]>
  ) => {
    begin(spanId, "sentinel", parent);
    const report = (path: string, overrides: Partial<SentinelEvent>) =>
      events.push(
        testSentinelEvent({
          uuid: `${spanId}:${path}`,
          span_id: spanId,
          step_id: stepId,
          stage,
          path,
          ...overrides,
        })
      );
    if (action) {
      report("gate/keywords", { kind: "observation", action: null });
      report("watch/risk_profile", { kind: "observation", action: null });
      report("gate", { action });
      report("", { action });
    } else {
      report("watch/output_scan", { kind: "observation", action: null });
    }
    end(spanId);
  };
  const call = (
    uuid: string,
    parent: string,
    callId: string,
    fn: string,
    args: Record<string, string>,
    nested?: () => void
  ) => {
    begin(`${uuid}-span`, "tool", parent);
    events.push(
      testToolEvent({
        uuid,
        span_id: `${uuid}-span`,
        id: callId,
        function: fn,
        arguments: args,
      })
    );
    nested?.();
    end(`${uuid}-span`);
  };
  const outerCall = testToolCall({
    id: "parent_t0_c0",
    function: "researcher",
    arguments: { input: "Find the database host in /work." },
  });
  const inner = (id: string, cmd: string) =>
    testToolCall({ id, function: "shell", arguments: { cmd } });

  begin("solvers", "solvers");
  begin("generate", "solver", "solvers");
  propose("m-outer", "generate", [outerCall]);
  checks("sen-outer-call", "generate", "parent_t0_c0", "tool_call", "continue");
  call(
    "tool-outer",
    "generate",
    "parent_t0_c0",
    "researcher",
    {
      input: "Find the database host in /work.",
    },
    () => {
      begin("agent", "agent", "tool-outer-span");
      propose("m-0", "agent", [inner("helper_t0_c0", "ls")]);
      checks("sen-0-call", "agent", "helper_t0_c0", "tool_call", "continue");
      call("tool-0", "agent", "helper_t0_c0", "shell", { cmd: "ls" });
      checks("sen-0-result", "agent", "helper_t0_c0", "tool_result");
      propose("m-1", "agent", [inner("helper_t1_c0", "curl")]);
      checks("sen-1-call", "agent", "helper_t1_c0", "tool_call", "reject");
      call("tool-1", "agent", "helper_t1_c0", "shell", { cmd: "curl" });
      propose("m-2", "agent", [inner("helper_t2_c0", "cat")]);
      checks("sen-2-call", "agent", "helper_t2_c0", "tool_call", "continue");
      call("tool-2", "agent", "helper_t2_c0", "shell", { cmd: "cat" });
      checks("sen-2-result", "agent", "helper_t2_c0", "tool_result");
      propose("m-3", "agent", []);
      end("agent");
    }
  );
  checks("sen-outer-result", "generate", "parent_t0_c0", "tool_result");
  propose("m-final", "generate", []);
  end("generate");
  end("solvers");

  it("pairs the outer call and each inner call with their own steps", () => {
    const result = pairToolSentinels(treeifyEvents(events, 0));
    const verdicts = Object.fromEntries(
      [...result.toolSentinels].map(([id, paired]) => [
        id,
        [paired.before?.verdict, paired.after?.verdict, paired.proposed?.id],
      ])
    );
    expect(verdicts).toEqual({
      "tool-outer": ["continue", "observe", "parent_t0_c0"],
      "tool-0": ["continue", "observe", "helper_t0_c0"],
      "tool-1": ["reject", undefined, "helper_t1_c0"],
      "tool-2": ["continue", "observe", "helper_t2_c0"],
    });
    expect(result.toolSentinels.get("tool-outer")?.before?.rows).toHaveLength(
      4
    );
    expect(result.standaloneSentinels.size).toBe(0);
    expect(result.sentinelScrollRedirects.get("sen-1-call:")).toBe("tool-1");
    expect(result.sentinelScrollRedirects.get("sen-outer-result")).toBe(
      "tool-outer"
    );
  });
});
