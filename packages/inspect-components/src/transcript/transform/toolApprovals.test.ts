import { describe, expect, it } from "vitest";

import {
  testApprovalEvent,
  testReviewEvent,
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
  it("keeps every approval for a call, in order", () => {
    const tool = toolNode("tool-1", "call-1");
    const chainA = approvalNode("appr-a", "call-1", { approver: "monitor" });
    const chainB = approvalNode("appr-b", "call-1", {
      approver: "auto",
      decision: "terminate",
    });
    const summary = approvalNode("appr-s", "call-1", {
      approver: "policy",
      decision: "terminate",
    });

    const result = pairToolApprovals([tool, chainA, chainB, summary]);

    expect(result.toolApprovals.get("call-1")?.map((n) => n.id)).toEqual([
      "appr-a",
      "appr-b",
      "appr-s",
    ]);
    expect(result.hiddenApprovalIds).toEqual(
      new Set(["appr-a", "appr-b", "appr-s"])
    );
  });

  it("pairs reviews with their tool the same way", () => {
    const tool = toolNode("tool-1", "call-1");
    const review = new EventNode(
      "rev-1",
      testReviewEvent({
        uuid: "rev-1",
        call: testToolCall({ id: "call-1", function: "bash" }),
        decision: "terminate",
        timestamp: "2026-01-01T00:00:02Z",
      }),
      0
    );

    const result = pairToolApprovals([tool, review]);

    expect(result.toolReviews.get("call-1")?.map((n) => n.id)).toEqual([
      "rev-1",
    ]);
    expect(result.hiddenApprovalIds.has("rev-1")).toBe(true);
    expect(result.approvalScrollRedirects.get("rev-1")).toBe("tool-1");
  });

  it("pairs an approval with its tool, hides it, and redirects to the tool node", () => {
    const tool = toolNode("tool-1", "call-1");
    const approval = approvalNode("appr-1", "call-1");

    const result = pairToolApprovals([tool, approval]);

    expect(result.toolApprovals.get("call-1")?.map((n) => n.id)).toEqual([
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

    expect(result.toolApprovals.get("call-1")?.map((n) => n.id)).toEqual([
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
    expect(result.toolApprovals.get("call-1")?.map((n) => n.id)).toEqual([
      "appr-1",
    ]);
    expect(result.hiddenApprovalIds.has("appr-1")).toBe(true);
    expect(result.approvalScrollRedirects.get("appr-1")).toBe("tool-1");
  });
});
