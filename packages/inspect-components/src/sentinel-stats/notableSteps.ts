import type { Event } from "@tsmono/inspect-common/types";

import {
  buildSentinelSteps,
  unjudgedReasonText,
  type SentinelStep,
} from "../transcript/transform/toolSentinels";

export type NotableStatus =
  "rejected" | "terminated" | "modified" | "escalated" | "not checked";

/** A step where a sentinel stepped in or didn't check, with what a reader needs to find it. */
export interface NotableStep {
  /** The uuid of the step's first event, which the transcript scrolls to; unset when the log recorded none. */
  eventId?: string;
  status: NotableStatus;
  /** The tool the step judged, or "model" at a model stage. */
  subject: string;
  stage: SentinelStep["stage"];
  reason?: string;
  /** The proxy of a remote sentinel's step, which ties it to that sentinel's stats. */
  proxyUrl?: string;
}

const statusOf = (step: SentinelStep): NotableStatus | undefined => {
  switch (step.verdict) {
    case "reject":
      return "rejected";
    case "terminate":
      return "terminated";
    case "modify":
      return "modified";
    case "escalate":
      return "escalated";
    case "unjudged":
      return "not checked";
    default:
      return undefined;
  }
};

/** The sample's steps where a sentinel stepped in or didn't check, in transcript order. */
export const notableSteps = (events: readonly Event[]): NotableStep[] => {
  const tools = new Map<string, string>();
  for (const event of events) {
    if (event.event === "tool") tools.set(event.id, event.function);
  }
  const notable: NotableStep[] = [];
  for (const [first, step] of buildSentinelSteps([...events])) {
    const status = statusOf(step);
    if (!status) continue;
    const toolStage =
      step.stage === "tool_call" || step.stage === "tool_result";
    notable.push({
      eventId: first.uuid ?? undefined,
      status,
      subject: (toolStage ? tools.get(step.stepId) : undefined) ?? "model",
      stage: step.stage,
      reason:
        status === "not checked" && step.reason
          ? unjudgedReasonText(step.reason)
          : step.reason,
      proxyUrl: step.remote?.proxy_url,
    });
  }
  return notable;
};
