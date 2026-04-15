/**
 * E2E tests for transcript event rendering components.
 *
 * These tests verify that each event type renders correctly in the
 * transcript Events tab. They serve as a baseline before extracting
 * transcript components into the shared inspect-components package.
 */
import { http, HttpResponse } from "msw";

import type {
  ErrorEvent,
  Event,
  ScoreEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";
import { encodeBase64Url } from "@tsmono/util";

import type {
  MessagesEventsResponse,
  TranscriptInfo,
} from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import {
  createMessagesEventsResponse,
  createModelEvent,
  createTimelineScenario,
  createTranscriptInfo,
} from "./fixtures/test-data";

const TRANSCRIPTS_DIR = "/home/test/project/.transcripts";
const TRANSCRIPT_ID = "t-events-001";

/**
 * Navigate directly to a transcript's Events tab.
 */
async function goToTranscriptEvents(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  events: Event[],
  options?: {
    messages?: MessagesEventsResponse["messages"];
    timelines?: MessagesEventsResponse["timelines"];
  }
) {
  const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);

  network.use(
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json<TranscriptInfo>(
        createTranscriptInfo({
          transcript_id: TRANSCRIPT_ID,
          task_id: "test-task",
          model: "claude-3",
        })
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
      HttpResponse.json<MessagesEventsResponse>(
        createMessagesEventsResponse({
          messages: options?.messages ?? [],
          events,
          timelines: options?.timelines ?? [],
        })
      )
    )
  );

  await page.goto(
    `/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}?tab=transcript-events`
  );
}

// ---------------------------------------------------------------------------
// Event factories
// ---------------------------------------------------------------------------

function createToolEvent(
  overrides?: Partial<ToolEvent> & { uuid?: string }
): ToolEvent {
  return {
    event: "tool",
    uuid: overrides?.uuid ?? "tool-evt-1",
    function: "bash",
    arguments: { cmd: "ls -la" },
    type: "function",
    id: "tool-call-1",
    result: "total 42\ndrwxr-xr-x 3 user staff 96 Jan 15 10:00 .",
    events: [],
    timestamp: "2025-01-15T10:00:05Z",
    working_start: 5,
    working_time: 2,
    ...overrides,
  };
}

function createScoreEvent(
  overrides?: Partial<ScoreEvent> & { uuid?: string }
): ScoreEvent {
  return {
    event: "score",
    uuid: overrides?.uuid ?? "score-evt-1",
    score: {
      value: "C",
      answer: "The answer is 42",
      explanation: "Correct based on the reference",
      history: [],
    },
    intermediate: false,
    timestamp: "2025-01-15T10:00:10Z",
    working_start: 10,
    ...overrides,
  };
}

function createErrorEvent(
  overrides?: Partial<ErrorEvent> & { uuid?: string }
): ErrorEvent {
  return {
    event: "error",
    uuid: overrides?.uuid ?? "error-evt-1",
    error: {
      message: "RuntimeError: division by zero",
      traceback:
        'Traceback (most recent call last):\n  File "eval.py", line 42\n    result = x / 0\nRuntimeError: division by zero',
      traceback_ansi:
        'Traceback (most recent call last):\n  File "eval.py", line 42\n    result = x / 0\nRuntimeError: division by zero',
    },
    timestamp: "2025-01-15T10:00:15Z",
    working_start: 15,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("transcript event rendering", () => {
  test("model event renders with chat messages and usage", async ({
    page,
    network,
  }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 2,
      endSec: 5,
      tokens: 500,
      content: "Here is my analysis of the code.",
    });

    // Add a user message to the model input
    modelEvent.input = [
      {
        role: "user",
        content: "Analyze this code for bugs",
        id: null,
      },
    ];

    await goToTranscriptEvents(page, network, [modelEvent]);

    // Model event panel should be visible with title
    await expect(page.getByText("Model Call:")).toBeVisible();

    // Output message should render (first match — Summary tab)
    await expect(
      page.getByText("Here is my analysis of the code.").first()
    ).toBeVisible();
  });

  test("tool event renders with function name and output", async ({
    page,
    network,
  }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 0,
      endSec: 2,
      content: "Let me check the files.",
    });
    modelEvent.output.choices[0]!.message.tool_calls = [
      {
        id: "tool-call-1",
        function: "bash",
        arguments: { cmd: "ls -la" },
        type: "function",
      },
    ];

    const toolEvent = createToolEvent();

    await goToTranscriptEvents(page, network, [modelEvent, toolEvent]);

    // Tool event panel should show tool name in title
    await expect(page.getByText("Tool: Bash")).toBeVisible();

    // Tool output should be visible
    await expect(page.getByText("total 42")).toBeVisible();
  });

  test("score event renders value and explanation", async ({
    page,
    network,
  }) => {
    const scoreEvent = createScoreEvent();

    await goToTranscriptEvents(page, network, [scoreEvent]);

    // Score panel should be visible
    await expect(page.getByText("Score").first()).toBeVisible();

    // Score value should render
    await expect(page.getByText("C").first()).toBeVisible();

    // Explanation should be visible
    await expect(
      page.getByText("Correct based on the reference")
    ).toBeVisible();
  });

  test("error event renders traceback", async ({ page, network }) => {
    const errorEvent = createErrorEvent();

    await goToTranscriptEvents(page, network, [errorEvent]);

    // Error panel should be visible
    await expect(page.getByText("Error").first()).toBeVisible();

    // Error message should render
    await expect(
      page.getByText("RuntimeError: division by zero")
    ).toBeVisible();
  });

  test("events can be collapsed and expanded", async ({ page, network }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 0,
      endSec: 3,
      content: "Model response content here",
    });

    await goToTranscriptEvents(page, network, [modelEvent]);

    // Content should be visible initially (first match — Summary tab)
    await expect(
      page.getByText("Model response content here").first()
    ).toBeVisible();

    // Click the collapse toggle (the panel title area)
    const collapseToggle = page
      .locator('[data-collapse-toggle="true"]')
      .first();
    if (await collapseToggle.isVisible()) {
      await collapseToggle.click();

      // Content should be hidden after collapse
      await expect(
        page.getByText("Model response content here").first()
      ).not.toBeVisible();

      // Click again to expand
      await collapseToggle.click();

      // Content should be visible again
      await expect(
        page.getByText("Model response content here").first()
      ).toBeVisible();
    }
  });

  test("agent card renders for agent spans", async ({ page, network }) => {
    const scenario = createTimelineScenario();

    await goToTranscriptEvents(page, network, scenario.events, {
      messages: scenario.messages,
      timelines: scenario.timelines,
    });

    // Agent span names should render
    await expect(page.getByText("Explore").first()).toBeVisible();
    await expect(page.getByText("Build").first()).toBeVisible();
  });
});
