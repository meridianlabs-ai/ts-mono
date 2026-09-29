import { describe, expect, it } from "vitest";

import {
  testModelEvent,
  testSentinelEvent,
  testSpanBeginEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { SentinelEvent } from "@tsmono/inspect-common/types";

import { EventNode } from "../types";

import {
  buildSentinelStep,
  foldedSummary,
  formatSuspicion,
  pairToolSentinels,
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
  action: NonNullable<SentinelEvent["decision"]>
): SentinelNode =>
  sentinel(id, {
    path,
    name,
    function: name,
    kind: "decision",
    decision: action,
    outcome: action,
  });

const layer = (
  id: string,
  path: string,
  name: string,
  kind: "bypassed" | "cancelled"
): SentinelNode =>
  sentinel(id, {
    path,
    name,
    kind,
    function: null,
    decision: null,
    outcome: null,
  });

const rowIds = (step: SentinelStep) => step.rows.map((r) => r.node.id);
const foldedIds = (step: SentinelStep) =>
  step.rows.flatMap((r) => r.folded.map((n) => n.id));

describe("buildSentinelStep", () => {
  it("folds the layers a final() bypassed onto the decision that took effect", () => {
    // The nested configuration from the sentinel design's Transcript section.
    const step = buildSentinelStep([
      decision(
        "internet",
        "attempt/internet_attempt",
        "internet_attempt",
        "escalate"
      ),
      layer("chain", "attempt", "chain", "bypassed"),
      decision("escape", "escape", "sandbox_escape", "continue"),
      layer("root", "", "concurrent", "bypassed"),
      decision("human", "attempt/human", "human", "reject"),
    ]);

    expect(rowIds(step)).toEqual(["internet", "human", "escape"]);
    expect(step.rows.map((r) => r.depth)).toEqual([1, 1, 0]);
    const human = step.rows.find((r) => r.node.id === "human");
    expect(human?.folded.map((n) => n.id)).toEqual(["chain", "root"]);
    expect(human?.effect).toBe("final");
    expect(step.rows.filter((r) => r.effect)).toHaveLength(1);
    expect(foldedIds(step)).toEqual(["chain", "root"]);
    expect(foldedSummary(human?.folded ?? [])).toBe("overrode 2 layers");
  });

  it("shows a terminate that a sibling's final() outran only in the fold", () => {
    const step = buildSentinelStep([
      decision("stop", "stop", "stopper", "terminate"),
      sentinel("stop-superseded", {
        path: "stop",
        name: "stopper",
        function: "stopper",
        kind: "superseded",
        decision: "terminate",
        outcome: null,
        explanation: "outran by human",
      }),
      layer("root", "", "concurrent", "bypassed"),
      decision("human", "human", "human", "continue"),
    ]);

    expect(rowIds(step)).toEqual(["human"]);
    const human = step.rows.find((r) => r.node.id === "human");
    expect(human?.effect).toBe("final");
    expect(human?.folded.map((n) => n.id)).toEqual(["stop-superseded", "root"]);
    expect(foldedSummary(human?.folded ?? [])).toBe(
      "overrode 1 layer · 1 decision superseded"
    );
  });

  it("folds cancelled siblings onto the root decision and lists the root first", () => {
    const step = buildSentinelStep([
      decision("allow", "allow", "allower", "continue"),
      decision("stop", "stop", "stopper", "terminate"),
      layer("slow-a", "slow_a", "slow", "cancelled"),
      layer("slow-b", "slow_b", "slow", "cancelled"),
      decision("root", "", "concurrent", "terminate"),
    ]);

    expect(rowIds(step)).toEqual(["root", "allow", "stop"]);
    expect(step.rows[0]?.depth).toBe(0);
    expect(step.rows[0]?.folded.map((n) => n.id)).toEqual(["slow-a", "slow-b"]);
    expect(foldedSummary(step.rows[0]?.folded ?? [])).toBe("2 cancelled");
    expect(step.rows.map((r) => r.effect)).toEqual([
      "took effect",
      undefined,
      undefined,
    ]);
  });

  it("hides a root that repeats its lone protocol's decision", () => {
    const threshold = sentinel("threshold", {
      path: "threshold",
      name: "threshold",
      kind: "decision",
      decision: "reject",
      outcome: "reject",
      explanation: "suspicion 0.95",
    });
    const root = sentinel("root", {
      path: "",
      name: "inspect_sentinel/concurrent",
      kind: "decision",
      decision: "reject",
      outcome: "reject",
      explanation: "suspicion 0.95",
    });
    const step = buildSentinelStep([
      sentinel("suspicion", {
        path: "threshold/suspicion",
        name: "suspicion",
        kind: "observation",
        suspicion: 0.95,
        decision: null,
        outcome: null,
      }),
      threshold,
      root,
    ]);

    expect(rowIds(step)).toEqual(["threshold", "suspicion"]);
    expect(step.rows.map((r) => r.depth)).toEqual([0, 1]);
    expect(step.rows.every((r) => r.effect === undefined)).toBe(true);
  });

  it("keeps a root whose decision differs from its lone deciding child", () => {
    const step = buildSentinelStep([
      decision("stop", "stop", "stopper", "terminate"),
      decision("root", "", "concurrent", "reject"),
    ]);
    expect(rowIds(step)).toEqual(["root", "stop"]);
  });

  it("keeps a root whose explanation adds to its child's", () => {
    const step = buildSentinelStep([
      decision("stop", "stop", "stopper", "reject"),
      sentinel("root", {
        path: "",
        name: "concurrent",
        decision: "reject",
        outcome: "reject",
        explanation: "combined",
      }),
    ]);
    expect(rowIds(step)).toEqual(["root", "stop"]);
  });

  it("moves the fold of a hidden root onto the child that took effect", () => {
    const step = buildSentinelStep([
      sentinel("monitor", {
        path: "monitor",
        name: "suspicion_monitor",
        function: "suspicion_monitor",
        kind: "observation",
        suspicion: 0.91,
        decision: null,
        outcome: null,
      }),
      decision("stop", "stop", "stopper", "terminate"),
      layer("slow-a", "slow_a", "slow", "cancelled"),
      layer("slow-b", "slow_b", "slow", "cancelled"),
      decision("root", "", "concurrent", "terminate"),
    ]);

    expect(rowIds(step)).toEqual(["monitor", "stop"]);
    expect(step.rows.map((r) => r.depth)).toEqual([0, 0]);
    expect(step.rows[1]?.folded.map((n) => n.id)).toEqual(["slow-a", "slow-b"]);
    expect(step.rows.map((r) => r.effect)).toEqual([undefined, "took effect"]);
  });

  it("keeps folded events on the step when no report took effect", () => {
    const step = buildSentinelStep([layer("a", "a", "slow", "cancelled")]);
    expect(step.rows).toEqual([]);
    expect(step.folded.map((n) => n.id)).toEqual(["a"]);
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
      decision: null,
      outcome: null,
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
      decision: null,
      outcome: null,
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
