import { describe, expect, it } from "vitest";

import {
  testSentinelEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";

import { notableSteps } from "./notableSteps";

describe("notableSteps", () => {
  it("lists the steps a sentinel stepped in on or didn't check, naming their tool", () => {
    const events = [
      testSentinelEvent({
        uuid: "a",
        step_id: "c1",
        path: "",
        action: "proceed",
      }),
      testToolEvent({ id: "c1", function: "bash" }),
      testSentinelEvent({
        uuid: "b",
        step_id: "c2",
        path: "",
        action: "reject",
        explanation: "no network",
      }),
      testToolEvent({ id: "c2", function: "python" }),
      testSentinelEvent({
        uuid: "c",
        step_id: "m1",
        stage: "model_output",
        path: "",
        status: "unjudged",
        reason: "cancelled",
        action: null,
      }),
    ];
    expect(notableSteps(events)).toEqual([
      expect.objectContaining({
        eventId: "b",
        status: "rejected",
        subject: "python",
        reason: "no network",
      }),
      expect.objectContaining({
        eventId: "c",
        status: "not checked",
        subject: "model",
        reason: "cancelled before judging finished",
      }),
    ]);
  });
});
