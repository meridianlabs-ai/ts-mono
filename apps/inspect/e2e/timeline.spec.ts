/**
 * Timeline acceptance e2e tests for Inspect.
 *
 * These tests verify that timelines (swimlanes) render in the Inspect
 * transcript panel when sample.timelines is populated. They are the
 * acceptance tests for the shared TimelineTranscriptView migration.
 *
 * Timeline support is now wired up via TranscriptLayout.
 */

import { http, HttpResponse } from "msw";

import type {
  ChatMessage,
  EvalSample,
  ModelEvent,
  ModelOutput,
  TimelineEvent as ServerTimelineEvent,
  TimelineSpan as ServerTimelineSpan,
  Timeline,
} from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
  createModelOutput,
} from "./fixtures/test-data";

const LOG_FILE = "test-timeline.json";

type Events = EvalSample["events"];

// ---------------------------------------------------------------------------
// Event & timeline factories
// ---------------------------------------------------------------------------

function createModelEvent(overrides?: {
  uuid?: string;
  content?: string;
  startSec?: number;
  endSec?: number;
  tokens?: number;
}): ModelEvent {
  const content = overrides?.content ?? "Model response";
  const tokens = overrides?.tokens ?? 100;
  const output: ModelOutput = {
    ...createModelOutput(content),
    usage: {
      input_tokens: Math.floor(tokens * 0.6),
      output_tokens: Math.floor(tokens * 0.4),
      total_tokens: tokens,
    },
    time: overrides?.endSec ? overrides.endSec - (overrides?.startSec ?? 0) : 3,
  };

  return {
    event: "model",
    uuid: overrides?.uuid ?? "model-evt-1",
    model: "claude-sonnet-4-5-20250929",
    input: [],
    output,
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: "2025-01-15T10:00:00Z",
    working_start: overrides?.startSec ?? 0,
    working_time: overrides?.endSec
      ? overrides.endSec - (overrides?.startSec ?? 0)
      : 3,
    error: null,
    traceback_ansi: null,
  };
}

function makeServerEvent(uuid: string): ServerTimelineEvent {
  return { type: "event", event: uuid };
}

function makeServerSpan(
  overrides: Partial<ServerTimelineSpan> & { id: string; name: string }
): ServerTimelineSpan {
  return {
    type: "span",
    span_type: null,
    content: [],
    branches: [],
    branched_from: null,
    description: null,
    utility: false,
    tool_invoked: false,
    agent_result: null,
    outline: null,
    ...overrides,
  } as ServerTimelineSpan;
}

function createSampleTimeline(eventUuids: string[]): Timeline {
  return {
    name: "default",
    description: "Agent timeline",
    root: makeServerSpan({
      id: "root",
      name: "Transcript",
      content: [
        makeServerEvent(eventUuids[0]!),
        makeServerSpan({
          id: "explore",
          name: "Explore",
          span_type: "agent",
          content: [makeServerEvent(eventUuids[1]!)],
        }),
        makeServerSpan({
          id: "build",
          name: "Build",
          span_type: "agent",
          content: [makeServerEvent(eventUuids[2]!)],
        }),
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTranscriptWithTimeline(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  options?: {
    messages?: ChatMessage[];
    sampleId?: number | string;
  }
) {
  const sampleId = options?.sampleId ?? 1;
  const messages = options?.messages ?? [
    { role: "user", content: "Hello", source: "input" },
    { role: "assistant", content: "Hi there", source: "generate" },
  ];

  const events: Events = [
    createModelEvent({ uuid: "evt-root", startSec: 0, endSec: 5, tokens: 200 }),
    createModelEvent({
      uuid: "evt-explore",
      startSec: 0,
      endSec: 3,
      tokens: 200,
      content: "Exploring the code",
    }),
    createModelEvent({
      uuid: "evt-build",
      startSec: 6,
      endSec: 12,
      tokens: 400,
      content: "Building the feature",
    }),
  ];

  const sample = createEvalSample({ id: sampleId, epoch: 1, messages });
  (sample as { events: Events }).events = events;
  (sample as { timelines: Timeline[] }).timelines = [
    createSampleTimeline(["evt-root", "evt-explore", "evt-build"]),
  ];

  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    http.get("*/api/log-files*", () => {
      return HttpResponse.json({
        files: [{ name: LOG_FILE, task: "chat-test", task_id: "chat-test" }],
        response_type: "full",
      });
    }),

    http.get("*/api/logs/:file", () => {
      return HttpResponse.json(evalLog);
    }),

    http.get("*/api/log-headers*", () => {
      return HttpResponse.json([
        {
          eval_id: logDetails.eval.eval_id,
          run_id: logDetails.eval.run_id,
          task: logDetails.eval.task,
          task_id: logDetails.eval.task_id,
          task_version: logDetails.eval.task_version,
          model: logDetails.eval.model,
          status: logDetails.status,
          started_at: logDetails.stats?.started_at,
          completed_at: logDetails.stats?.completed_at,
        },
      ]);
    })
  );

  const encodedFile = encodeURIComponent(LOG_FILE);
  await page.goto(
    `/#/logs/${encodedFile}/samples/sample/${sampleId}/1/transcript`
  );
}

// ---------------------------------------------------------------------------
// Timeline acceptance tests
// ---------------------------------------------------------------------------

test("sample with timelines shows swimlane grid", async ({ page, network }) => {
  await openTranscriptWithTimeline(page, network);

  // Swimlane grid should be visible
  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Child agent rows should be visible
  await expect(
    swimlane.getByRole("row").filter({ hasText: "Explore" })
  ).toBeVisible();
  await expect(
    swimlane.getByRole("row").filter({ hasText: "Build" })
  ).toBeVisible();
});

test("sample with timelines shows event list", async ({ page, network }) => {
  await openTranscriptWithTimeline(page, network);

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Click the root "Transcript" row to show all events
  const rootRow = swimlane.getByRole("row").filter({ hasText: "Transcript" });
  await rootRow.click();

  // Root event and sub-agent entries should be visible in the event list
  await expect(page.getByText("sub-agent: explore").first()).toBeVisible();
  await expect(page.getByText("sub-agent: build").first()).toBeVisible();
});

test("clicking a swimlane row updates selection", async ({ page, network }) => {
  await openTranscriptWithTimeline(page, network);

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Click the "Build" row
  const buildRow = swimlane.getByRole("row").filter({ hasText: "Build" });
  await buildRow.click();

  // The event list should now show only the Build agent's content
  await expect(page.getByText("Building the feature").first()).toBeVisible();

  // The Explore agent's content should no longer be visible
  await expect(page.getByText("Exploring the code")).not.toBeVisible();
});
