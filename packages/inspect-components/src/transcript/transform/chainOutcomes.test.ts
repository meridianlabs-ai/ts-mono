import { describe, expect, it } from "vitest";

import {
  testApprovalEvent,
  testToolCall,
} from "@tsmono/inspect-common/testing";
import type { ApprovalEvent } from "@tsmono/inspect-common/types";

import { EventNode } from "../types";

import { chainOutcomes, groupByChain } from "./chainOutcomes";

const approval = (
  id: string,
  overrides: Partial<ApprovalEvent>
): EventNode<ApprovalEvent> =>
  new EventNode(
    id,
    testApprovalEvent({
      uuid: id,
      call: testToolCall({ id: "call-1", function: "bash" }),
      ...overrides,
    }),
    0
  );

const summary = approval("sum", {
  approver: "policy",
  decision: "terminate",
  metadata: {
    chains: {
      monitor: { decision: "approve", explanation: "fine" },
      other: { decision: "terminate", explanation: "no network" },
      late: { decision: "cancelled", explanation: null },
    },
  },
});

describe("chainOutcomes", () => {
  it("reads the per-chain outcomes off a policy summary", () => {
    expect(chainOutcomes(summary.event)).toEqual({
      monitor: { decision: "approve", explanation: "fine" },
      other: { decision: "terminate", explanation: "no network" },
      late: { decision: "cancelled", explanation: null },
    });
  });

  it("is undefined for an ordinary approver's event", () => {
    expect(
      chainOutcomes(approval("a", { approver: "human" }).event)
    ).toBeUndefined();
  });
});

describe("groupByChain", () => {
  it("puts each chain's events under its heading, in order, verdict first", () => {
    const escalate = approval("m1", {
      approver: "auto",
      decision: "escalate",
      chain: "monitor",
    });
    const approve = approval("m2", {
      approver: "human",
      decision: "approve",
      chain: "monitor",
    });
    const terminate = approval("o1", {
      approver: "auto",
      decision: "terminate",
      chain: "other",
    });

    const groups = groupByChain([escalate, approve, terminate, summary]);

    expect(groups?.summary.id).toBe("sum");
    expect(
      groups?.chains.map((c) => [
        c.name,
        c.outcome.decision,
        c.nodes.map((n) => n.id),
      ])
    ).toEqual([
      ["monitor", "approve", ["m1", "m2"]],
      ["other", "terminate", ["o1"]],
      ["late", "cancelled", []],
    ]);
  });

  it("is undefined without a summary, so a lone chain renders flat", () => {
    expect(
      groupByChain([approval("a", { approver: "human" })])
    ).toBeUndefined();
  });
});
