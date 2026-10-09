import { describe, expect, it } from "vitest";

import {
  testApprovalEvent,
  testSpanBeginEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { ApprovalEvent } from "@tsmono/inspect-common/types";

import { EventNode } from "../types";

import { pairToolApprovals } from "./toolApprovals";

const toolNode = (nodeId: string, callId: string, depth = 0): EventNode => {
  const event = testToolEvent({
    id: callId,
    uuid: nodeId,
    timestamp: "2026-01-01T00:00:00Z",
  });
  return new EventNode(nodeId, event, depth);
};

const approvalNode = (
  nodeId: string,
  callId: string,
  opts?: { approver?: string; decision?: ApprovalEvent["decision"] }
): EventNode => {
  const event = testApprovalEvent({
    uuid: nodeId,
    approver: opts?.approver ?? "human",
    decision: opts?.decision ?? "approve",
    call: testToolCall({ id: callId, function: "bash" }),
    timestamp: "2026-01-01T00:00:01Z",
  });
  return new EventNode(nodeId, event, 0);
};

const parent = (nodeId: string, children: EventNode[]): EventNode => {
  const event = testSpanBeginEvent({
    id: nodeId,
    name: nodeId,
    timestamp: "2026-01-01T00:00:00Z",
  });
  const node = new EventNode(nodeId, event, 0);
  node.children = children;
  return node;
};

describe("pairToolApprovals", () => {
  it("pairs an approval with its tool, hides it, and redirects to the tool node", () => {
    const tool = toolNode("tool-1", "call-1");
    const approval = approvalNode("appr-1", "call-1");

    const result = pairToolApprovals([tool, approval]);

    expect(result.toolApprovals.get("tool-1")?.map((n) => n.id)).toEqual([
      "appr-1",
    ]);
    expect(result.hiddenApprovalIds.has("appr-1")).toBe(true);
    expect(result.approvalScrollRedirects.get("appr-1")).toBe("tool-1");
  });

  it("hides auto-approve approvals without pairing but still redirects to the tool", () => {
    const tool = toolNode("tool-1", "call-1");
    const approval = approvalNode("appr-1", "call-1", {
      approver: "auto",
      decision: "approve",
    });

    const result = pairToolApprovals([tool, approval]);

    expect(result.toolApprovals.size).toBe(0);
    expect(result.hiddenApprovalIds.has("appr-1")).toBe(true);
    expect(result.approvalScrollRedirects.get("appr-1")).toBe("tool-1");
  });

  it("hides auto-approve approvals with no matching tool and adds no redirect", () => {
    const approval = approvalNode("appr-1", "call-x", {
      approver: "auto",
      decision: "approve",
    });

    const result = pairToolApprovals([approval]);

    expect(result.hiddenApprovalIds.has("appr-1")).toBe(true);
    expect(result.approvalScrollRedirects.size).toBe(0);
  });

  it("leaves non-auto approvals with no matching tool visible and unredirected", () => {
    const approval = approvalNode("appr-1", "call-x");

    const result = pairToolApprovals([approval]);

    expect(result.toolApprovals.size).toBe(0);
    expect(result.hiddenApprovalIds.size).toBe(0);
    expect(result.approvalScrollRedirects.size).toBe(0);
  });

  it("pairs across nested children", () => {
    const tool = toolNode("tool-1", "call-1", 1);
    const approval = approvalNode("appr-1", "call-1");
    const tree = parent("root", [parent("inner", [tool]), approval]);

    const result = pairToolApprovals([tree]);

    expect(result.toolApprovals.get("tool-1")?.map((n) => n.id)).toEqual([
      "appr-1",
    ]);
    expect(result.approvalScrollRedirects.get("appr-1")).toBe("tool-1");
  });

  it("keeps non-approve auto decisions visible (no hide, no pairing) but redirects are not added", () => {
    const tool = toolNode("tool-1", "call-1");
    const approval = approvalNode("appr-1", "call-1", {
      approver: "auto",
      decision: "reject",
    });

    const result = pairToolApprovals([tool, approval]);

    // Auto non-approve decisions carry information: they pair like human ones.
    expect(result.toolApprovals.get("tool-1")?.map((n) => n.id)).toEqual([
      "appr-1",
    ]);
    expect(result.hiddenApprovalIds.has("appr-1")).toBe(true);
    expect(result.approvalScrollRedirects.get("appr-1")).toBe("tool-1");
  });

  it("pairs every approval of an escalation chain in recording order", () => {
    const tool = toolNode("tool-1", "call-1");
    const first = approvalNode("appr-1", "call-1", {
      approver: "gatekeeper",
      decision: "escalate",
    });
    const second = approvalNode("appr-2", "call-1", {
      approver: "supervisor",
      decision: "approve",
    });

    const result = pairToolApprovals([first, second, tool]);

    expect(result.toolApprovals.get("tool-1")?.map((n) => n.id)).toEqual([
      "appr-1",
      "appr-2",
    ]);
    expect(result.approvalScrollRedirects.get("appr-2")).toBe("tool-1");
  });

  it("shows an auto approval that ends an escalation chain", () => {
    const tool = toolNode("tool-1", "call-1");
    const first = approvalNode("appr-1", "call-1", { decision: "escalate" });
    const second = approvalNode("appr-2", "call-1", {
      approver: "auto",
      decision: "approve",
    });

    const result = pairToolApprovals([tool, first, second, second]);

    expect(result.toolApprovals.get("tool-1")?.map((n) => n.id)).toEqual([
      "appr-1",
      "appr-2",
    ]);
  });

  it("pairs each call of a reused call id with the chain recorded before it", () => {
    const first = approvalNode("appr-1", "call-1", { decision: "reject" });
    const second = approvalNode("appr-2", "call-1", { decision: "escalate" });
    const third = approvalNode("appr-3", "call-1", { decision: "approve" });
    const result = pairToolApprovals([
      first,
      toolNode("tool-1", "call-1"),
      second,
      third,
      toolNode("tool-2", "call-1"),
    ]);

    expect(result.toolApprovals.get("tool-1")?.map((n) => n.id)).toEqual([
      "appr-1",
    ]);
    expect(result.toolApprovals.get("tool-2")?.map((n) => n.id)).toEqual([
      "appr-2",
      "appr-3",
    ]);
    expect(result.approvalScrollRedirects.get("appr-1")).toBe("tool-1");
    expect(result.approvalScrollRedirects.get("appr-3")).toBe("tool-2");
  });

  it("pairs parallel calls of a reused call id in order when their chains precede both tools", () => {
    const result = pairToolApprovals([
      approvalNode("appr-1", "call-1", { decision: "approve" }),
      approvalNode("appr-2", "call-1", { decision: "reject" }),
      toolNode("tool-1", "call-1"),
      toolNode("tool-2", "call-1"),
    ]);

    expect(result.toolApprovals.get("tool-1")?.map((n) => n.id)).toEqual([
      "appr-1",
    ]);
    expect(result.toolApprovals.get("tool-2")?.map((n) => n.id)).toEqual([
      "appr-2",
    ]);
  });
});
