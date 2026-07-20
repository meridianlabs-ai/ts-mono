/**
 * Regression coverage (t.46): at a narrow viewport, the sticky EventPanel
 * header (turnNav cluster + tab picker + title) must degrade gracefully —
 * title truncates, nothing wraps to a second line, and the tab picker never
 * renders detached from the header it belongs to.
 *
 * Repro shape mirrors the reported regression: a deeply nested agent
 * transcript (5 lanes: main / orchestrator / planner / worker 2 / verifier)
 * with a turn-bearing model event, viewed at 768x1024 with the outline side
 * panel expanded.
 */
import type { NetworkFixture } from "@msw/playwright";
import { http, HttpResponse } from "msw";

import type { ModelEvent } from "@tsmono/inspect-common/types";
import { encodeBase64Url } from "@tsmono/util";

import type {
  MessagesEventsResponse,
  ServerTimelineSpan,
  TranscriptInfo,
  TranscriptsResponse,
} from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import {
  createMessagesEventsResponse,
  createTimeline,
  createTimelineSpan,
  createTranscriptInfo,
  createTranscriptsResponse,
} from "./fixtures/test-data";

const TRANSCRIPTS_DIR = "/home/test/project/.transcripts";
const TRANSCRIPT_ID = "t-header-narrow-001";

function isoOffset(seconds: number): string {
  return new Date(
    new Date("2025-01-15T10:00:00Z").getTime() + seconds * 1000
  ).toISOString();
}

/** Model event with a caller-supplied model name, so the header title's
 *  length is controllable (matches the reported repro's real-world title). */
function createModelEventWithModel(options: {
  uuid: string;
  model: string;
  startSec: number;
  endSec: number;
  tokens?: number;
  content?: string;
  spanId?: string;
}): ModelEvent {
  const tokens = options.tokens ?? 69;
  return {
    event: "model",
    uuid: options.uuid,
    model: options.model,
    input: [],
    tools: [],
    tool_choice: "auto",
    config: {},
    output: {
      choices: [
        {
          message: {
            role: "assistant",
            content: options.content ?? "Default output",
            id: null,
          },
          stop_reason: "stop",
        },
      ],
      completion: options.content ?? "Default output",
      model: options.model,
      usage: {
        input_tokens: Math.floor(tokens * 0.6),
        output_tokens: Math.floor(tokens * 0.4),
        total_tokens: tokens,
      },
    },
    timestamp: isoOffset(options.startSec),
    completed: isoOffset(options.endSec),
    working_start: options.startSec,
    working_time: options.endSec - options.startSec,
    span_id: options.spanId ?? null,
  };
}

/**
 * Five-deep agent nest — main / orchestrator / planner / worker 2 / verifier —
 * with two turns (model calls) in the deepest lane, plus a further nested
 * sub-agent ("deep_checker") below it. Mirrors the reported repro transcript.
 */
function createDeepNestScenario(): MessagesEventsResponse {
  const turn1 = createModelEventWithModel({
    uuid: "verifier-turn-1",
    model: "mockllm/model",
    startSec: 0,
    endSec: 0,
    spanId: "verifier",
  });
  const turn2 = createModelEventWithModel({
    uuid: "verifier-turn-2",
    model: "mockllm/model",
    startSec: 1,
    endSec: 1,
    spanId: "verifier",
  });
  const checkerEvent = createModelEventWithModel({
    uuid: "checker-1",
    model: "mockllm/model",
    startSec: 2,
    endSec: 2,
    spanId: "deep_checker",
  });

  const deepCheckerSpan: ServerTimelineSpan = createTimelineSpan({
    id: "deep_checker",
    name: "deep_checker",
    span_type: "agent",
    content: [{ type: "event", event: "checker-1" }],
  });
  const verifierSpan: ServerTimelineSpan = createTimelineSpan({
    id: "verifier",
    name: "verifier",
    span_type: "agent",
    content: [
      { type: "event", event: "verifier-turn-1" },
      { type: "event", event: "verifier-turn-2" },
      deepCheckerSpan,
    ],
  });
  const worker2Span: ServerTimelineSpan = createTimelineSpan({
    id: "worker-2",
    name: "worker 2",
    span_type: "agent",
    content: [verifierSpan],
  });
  const plannerSpan: ServerTimelineSpan = createTimelineSpan({
    id: "planner",
    name: "planner",
    span_type: "agent",
    content: [worker2Span],
  });
  const orchestratorSpan: ServerTimelineSpan = createTimelineSpan({
    id: "orchestrator",
    name: "orchestrator",
    span_type: "agent",
    content: [plannerSpan],
  });
  const rootSpan: ServerTimelineSpan = createTimelineSpan({
    id: "main",
    name: "main",
    span_type: "agent",
    content: [orchestratorSpan],
  });

  return createMessagesEventsResponse({
    messages: [{ role: "user", content: "Verify the deep nesting breadcrumb" }],
    events: [turn1, turn2, checkerEvent],
    timelines: [createTimeline(rootSpan)],
  });
}

function setupTranscript(
  network: NetworkFixture,
  messagesEvents: MessagesEventsResponse
) {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(
        createTranscriptsResponse([
          createTranscriptInfo({
            transcript_id: TRANSCRIPT_ID,
            task_id: "header-narrow-task",
            model: "mockllm/model",
          }),
        ])
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json<TranscriptInfo>(
        createTranscriptInfo({
          transcript_id: TRANSCRIPT_ID,
          task_id: "header-narrow-task",
          model: "mockllm/model",
        })
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
      HttpResponse.json<MessagesEventsResponse>(messagesEvents)
    )
  );
}

function transcriptUrl(): string {
  const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
  return `/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}`;
}

test("model call header stays contained at a narrow viewport with the outline expanded", async ({
  page,
  network,
}) => {
  setupTranscript(network, createDeepNestScenario());

  // Narrow viewport (matches the reported repro), DPR2 to match the
  // reference screenshots (visual confirmation only; layout math is CSS px).
  await page.setViewportSize({ width: 768, height: 1024 });

  await page.goto(transcriptUrl());

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Drill into the deepest lane by clicking each nested sub-agent card in
  // turn, so the swimlane breadcrumb ends up showing all 5 segments (main /
  // orchestrator / planner / worker 2 / verifier) — the repro's deep agent
  // breadcrumb.
  for (const agentName of ["ORCHESTRATOR", "PLANNER", "WORKER 2", "VERIFIER"]) {
    await page
      .getByText(`SUB-AGENT: ${agentName}`, { exact: false })
      .first()
      .click();
  }

  // Expand the outline side panel (collapsed by default in Scout).
  const showOutline = page.getByRole("button", { name: "Show outline" });
  if (await showOutline.isVisible()) {
    await showOutline.click();
  }

  await expect(page.getByText("turn 1/2").first()).toBeVisible();

  // --- Invariant 1: the sticky header's content stays within one row. ---
  const header = page
    .locator("[class*='stickyWrapper']")
    .filter({ hasText: "MODEL CALL" })
    .first();
  await expect(header).toBeVisible();
  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  // A single-line header (icon + uppercase small text) is comfortably under
  // 40px tall; a wrapped title pushes this well past 50px.
  expect(headerBox!.height).toBeLessThan(40);

  // --- Invariant 2: the tab picker never overlaps the title cell. The
  // header's direct-child <div>s are, in order, the title cell and the
  // picker/nav cell (`.navs`) — grid-column order, independent of hashed
  // CSS-module class names. When the `.navs` track collapses to 0 width
  // (starved by the turnNav cluster), its flex-end-anchored picker button
  // still renders at its natural size and spills backwards, left over the
  // title's own cell — this is the "detached, overlapping" picker from the
  // regression, measurable as a horizontal overlap between the two cells. ---
  const directDivs = header.locator(":scope > div");
  const titleCell = directDivs.nth(0);
  const navsCell = directDivs.nth(1);
  await expect(titleCell).toHaveText(/model call/i);
  const titleBox = await titleCell.boundingBox();
  expect(titleBox).not.toBeNull();
  const picker = navsCell.locator("button").first();
  await expect(picker).toBeVisible();
  const pickerBox = await picker.boundingBox();
  expect(pickerBox).not.toBeNull();
  expect(pickerBox!.x).toBeGreaterThanOrEqual(titleBox!.x + titleBox!.width);
});
