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
  opts?: {
    approver?: string;
    decision?: ApprovalEvent["decision"];
    stage?: ApprovalEvent["stage"];
  }
): EventNode => {
  const event = testApprovalEvent({
    uuid: nodeId,
    approver: opts?.approver ?? "human",
    decision: opts?.decision ?? "approve",
    stage: opts?.stage ?? "call",
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

    expect(result.toolApprovals.get("call-1")?.id).toBe("appr-1");
    expect(result.hiddenApprovalIds.has("appr-1")).toBe(true);
    expect(result.approvalScrollRedirects.get("appr-1")).toBe("tool-1");
  });

  it("leaves a result-stage approval as its own row alongside the paired call-stage one", () => {
    const tool = toolNode("tool-1", "call-1");
    const callStage = approvalNode("appr-1", "call-1");
    const resultStage = approvalNode("appr-2", "call-1", {
      approver: "monitor",
      decision: "reject",
      stage: "result",
    });

    const result = pairToolApprovals([tool, callStage, resultStage]);

    expect(result.toolApprovals.get("call-1")?.id).toBe("appr-1");
    expect(result.hiddenApprovalIds.has("appr-1")).toBe(true);
    expect(result.hiddenApprovalIds.has("appr-2")).toBe(false);
  });

  it("hides an auto-approved result-stage approval like any other auto approval", () => {
    const tool = toolNode("tool-1", "call-1");
    const resultStage = approvalNode("appr-2", "call-1", {
      approver: "auto",
      stage: "result",
    });

    const result = pairToolApprovals([tool, resultStage]);

    expect(result.toolApprovals.has("call-1")).toBe(false);
    expect(result.hiddenApprovalIds.has("appr-2")).toBe(true);
    expect(result.approvalScrollRedirects.get("appr-2")).toBe("tool-1");
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

    expect(result.toolApprovals.get("call-1")?.id).toBe("appr-1");
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
    expect(result.toolApprovals.get("call-1")?.id).toBe("appr-1");
    expect(result.hiddenApprovalIds.has("appr-1")).toBe(true);
    expect(result.approvalScrollRedirects.get("appr-1")).toBe("tool-1");
  });
});
