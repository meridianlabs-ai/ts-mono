/**
 * Regression test for top-level sample-lifecycle events (ts-mono#178).
 *
 * A `SampleLimitEvent` (e.g. an operator interrupt) is recorded with
 * `span_id=null` — it belongs to no agent span. When the transcript has the
 * usual init/solvers/scorers phase spans, `buildTimeline` previously consumed
 * only those spans and dropped any top-level orphan event, making the event
 * invisible in swimlane views. It must instead land in the root span's content.
 */

import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSampleLimitEvent,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";

import { buildTimeline, TimelineEvent, type TimelineSpan } from "./core";
import { rawEventBuilders } from "./testHelpers";

const { ts, base, spanBegin, spanEnd } = rawEventBuilders();

function modelTurn(spanId: string): Event {
  return testModelEvent({
    ...base(),
    model: "mockllm/model",
    completed: ts(),
    span_id: spanId,
    input: [testUserMessage({ content: "go" })],
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ content: "ok" }),
          stop_reason: "stop",
        }),
      ],
      usage: testModelUsage({ input_tokens: 5, output_tokens: 1 }),
    }),
  });
}

function sampleLimitEvent(): Event {
  return testSampleLimitEvent({
    ...base(),
    type: "operator",
    message: "Sample completed: interrupted by operator",
    limit: null,
    span_id: null,
  });
}

/** Recursively collect the underlying Events from a span's content tree. */
function collectEvents(span: TimelineSpan): Event[] {
  const out: Event[] = [];
  for (const item of span.content) {
    if (item instanceof TimelineEvent) {
      out.push(item.event);
    } else {
      out.push(...collectEvents(item));
    }
  }
  return out;
}

describe("top-level sample-lifecycle events", () => {
  // A normal eval transcript: init/solvers/scorers phase spans, then an
  // operator-interrupt SampleLimitEvent at the top level (span_id=null).
  const events: Event[] = [
    spanBegin("init", "init", "init", null),
    spanEnd("init"),
    spanBegin("solvers", "solvers", "solvers", null),
    modelTurn("solvers"),
    spanEnd("solvers"),
    sampleLimitEvent(),
  ];

  const timeline = buildTimeline(events);

  it("includes the sample_limit event in the timeline tree", () => {
    const collected = collectEvents(timeline.root);
    expect(collected.some((e) => e.event === "sample_limit")).toBe(true);
  });
});
