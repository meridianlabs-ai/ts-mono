import { describe, expect, it } from "vitest";

import {
  testModelEvent,
  testSentinelEvent,
  testSpanBeginEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { SentinelEvent } from "@tsmono/inspect-common/types";

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

  it("credits the first of several children that made the decision", () => {
    const step = buildSentinelStep([
      decision("c", "c", "rule", "continue"),
      withExplanation(decision("a", "a", "rule", "reject"), "first"),
      withExplanation(decision("b", "b", "rule", "reject"), "second"),
      withExplanation(decision("root", "", "concurrent", "reject"), "second"),
    ]);
    expect(step.effective?.id).toBe("a");
    expect(step.reason).toBe("first");
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

  it("pairs call and result stages with their tool and hides every event", () => {
    const before = decision("before", "", "protocol", "continue");
    const after = sentinel("after", {
      stage: "tool_result",
      kind: "observation",
      suspicion: { exfiltration: 0.2 },
      action: null,
    });
    const result = pairToolSentinels([before, tool("tool-1", "call_1"), after]);

    const paired = result.toolSentinels.get("call_1");
    expect(paired?.before && rowIds(paired.before)).toEqual(["before"]);
    expect(paired?.after && rowIds(paired.after)).toEqual(["after"]);
    expect([...result.hiddenSentinelIds]).toEqual(["before", "after"]);
    expect(result.sentinelScrollRedirects.get("after")).toBe("tool-1");
    expect(result.standaloneSentinels.size).toBe(0);
  });

  it("finds tools and events across nested children once each", () => {
    const toolNode = tool("tool-1", "call_1");
    const event = decision("before", "", "protocol", "continue");
    toolNode.children = [event];
    // Flat lists carry descendants both nested and as their own entries.
    const result = pairToolSentinels([toolNode, event]);
    expect(
      result.toolSentinels.get("call_1")?.before?.rows.map((r) => r.node.id)
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

    const before = result.toolSentinels.get("call_1")?.before;
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
      result.toolSentinels.get("call_1")?.before?.modelCalls.map((n) => n.id)
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
