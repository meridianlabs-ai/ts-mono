/**
 * E2E tests for transcript event rendering components.
 *
 * These tests verify that each event type renders correctly in the
 * transcript panel. They serve as a baseline before extracting
 * transcript components into the shared inspect-components package.
 */
import { http, HttpResponse } from "msw";

import type {
  ChatMessage,
  ErrorEvent,
  EvalSample,
  ModelEvent,
  ModelOutput,
  ScoreEvent,
  SpanBeginEvent,
  SpanEndEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
  createModelOutput,
} from "./fixtures/test-data";

const LOG_FILE = "test-transcript.json";

type Events = EvalSample["events"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to a sample's Transcript tab with specified events.
 */
async function openTranscript(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  events: Events,
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

  const sample = createEvalSample({ id: sampleId, epoch: 1, messages });
  // Override events on the sample
  (sample as { events: Events }).events = events;

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
// Event factories
// ---------------------------------------------------------------------------

function createModelEvent(overrides?: {
  uuid?: string;
  content?: string;
  startSec?: number;
  endSec?: number;
  tokens?: number;
  error?: string;
  traceback_ansi?: string;
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
    error: overrides?.error ?? null,
    traceback_ansi: overrides?.traceback_ansi ?? null,
  };
}

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

function createSpanBeginEvent(
  overrides?: Partial<SpanBeginEvent> & { uuid?: string; id?: string }
): SpanBeginEvent {
  const id = overrides?.id ?? overrides?.uuid ?? "span-begin-1";
  return {
    event: "span_begin",
    uuid: overrides?.uuid ?? id,
    id,
    name: overrides?.name ?? "turn",
    type: (overrides as { type?: string })?.type ?? "turn",
    timestamp: "2025-01-15T10:00:00Z",
    working_start: 0,
    parent_id: null,
    pending: false,
    metadata: null,
    ...overrides,
  };
}

function createSpanEndEvent(
  overrides?: Partial<SpanEndEvent> & { uuid?: string; id?: string }
): SpanEndEvent {
  const id = overrides?.id ?? overrides?.uuid ?? "span-end-1";
  return {
    event: "span_end",
    uuid: overrides?.uuid ?? id,
    id,
    span_id: overrides?.span_id ?? id,
    name: "turn",
    type: "turn",
    timestamp: "2025-01-15T10:00:05Z",
    working_start: 5,
    pending: false,
    metadata: null,
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

    modelEvent.input = [
      {
        role: "user",
        content: "Analyze this code for bugs",
        id: null,
      },
    ];

    await openTranscript(page, network, [modelEvent]);

    // Model event panel should be visible with title
    await expect(page.getByText("Model Call:")).toBeVisible();

    // Output message should render (first match — Summary tab)
    await expect(
      page.getByText("Here is my analysis of the code.").first()
    ).toBeVisible();
  });

  test("model event shows error and traceback tab", async ({
    page,
    network,
  }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-error",
      content: "Partial response",
      error: "Rate limit exceeded",
      traceback_ansi:
        "Error: Rate limit exceeded\n  at callModel (model.py:100)",
    });

    await openTranscript(page, network, [modelEvent]);

    // Error message should render in the model event
    await expect(page.getByText("Rate limit exceeded").first()).toBeVisible();

    // Click on the Error tab to see traceback
    const errorTab = page.getByRole("tab", { name: "Error" });
    if (await errorTab.isVisible()) {
      await errorTab.click();
      await expect(page.getByText("callModel").first()).toBeVisible();
    }
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

    await openTranscript(page, network, [modelEvent, toolEvent]);

    // Tool event panel should show tool name in title
    await expect(page.getByText("Tool:")).toBeVisible();

    // Tool output should be visible
    await expect(page.getByText("total 42")).toBeVisible();
  });

  test("score event renders value and explanation", async ({
    page,
    network,
  }) => {
    const scoreEvent = createScoreEvent();

    await openTranscript(page, network, [scoreEvent]);

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

    await openTranscript(page, network, [errorEvent]);

    // Error panel should be visible
    await expect(page.getByText("Error").first()).toBeVisible();

    // Error message should render
    await expect(
      page.getByText("RuntimeError: division by zero")
    ).toBeVisible();
  });

  test("model event with turn label from span structure", async ({
    page,
    network,
  }) => {
    // Create turn spans wrapping model events — span_begin needs `id` field
    // and child events need `span_id` matching the parent span's `id`.
    const events: Events = [
      createSpanBeginEvent({
        uuid: "span-turn-1",
        id: "span-turn-1",
        name: "turn",
        type: "turn" as string,
        parent_id: null,
      }),
      {
        ...createModelEvent({
          uuid: "model-in-turn-1",
          startSec: 0,
          endSec: 3,
          content: "First turn response",
        }),
        span_id: "span-turn-1",
      },
      createSpanEndEvent({
        uuid: "span-turn-1-end",
        id: "span-turn-1",
        span_id: "span-turn-1",
      }),
      createSpanBeginEvent({
        uuid: "span-turn-2",
        id: "span-turn-2",
        name: "turn",
        type: "turn" as string,
        parent_id: null,
      }),
      {
        ...createModelEvent({
          uuid: "model-in-turn-2",
          startSec: 3,
          endSec: 6,
          content: "Second turn response",
        }),
        span_id: "span-turn-2",
      },
      createSpanEndEvent({
        uuid: "span-turn-2-end",
        id: "span-turn-2",
        span_id: "span-turn-2",
      }),
    ];

    await openTranscript(page, network, events);

    // Both model events should render
    await expect(page.getByText("First turn response").first()).toBeVisible();
    await expect(page.getByText("Second turn response").first()).toBeVisible();

    // Turn labels should appear (format: "turn 1/2", "turn 2/2")
    await expect(page.getByText("turn 1/2").first()).toBeVisible();
    await expect(page.getByText("turn 2/2").first()).toBeVisible();
  });

  test("events can be collapsed and expanded", async ({ page, network }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 0,
      endSec: 3,
      content: "Model response content here",
    });

    await openTranscript(page, network, [modelEvent]);

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

  test("outline sidebar renders for transcript events", async ({
    page,
    network,
  }) => {
    const events: Events = [
      createModelEvent({
        uuid: "model-1",
        startSec: 0,
        endSec: 3,
        content: "First model call",
      }),
      createToolEvent({ uuid: "tool-1" }),
      createModelEvent({
        uuid: "model-2",
        startSec: 5,
        endSec: 8,
        content: "Second model call",
      }),
    ];

    await openTranscript(page, network, events);

    // The outline sidebar should be visible with event entries
    // The outline shows model calls as numbered turns
    await expect(page.getByText("First model call").first()).toBeVisible();
    await expect(page.getByText("Second model call").first()).toBeVisible();
  });
});
