/**
 * E2E tests for transcript event rendering components.
 *
 * These tests verify that each event type renders correctly in the
 * transcript panel.
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
    // get_log_root — the dir-mode gate blocks on this; without it the app
    // stays on "Loading logs…" and never renders the transcript.
    http.get("*/api/logs", () => {
      return HttpResponse.json({ log_dir: "/logs" });
    }),

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
    time: overrides?.endSec ? overrides.endSec - (overrides.startSec ?? 0) : 3,
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
      ? overrides.endSec - (overrides.startSec ?? 0)
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

    await expect(
      page.getByText(/^Model Call: claude-sonnet-4-5-20250929 \(500 tokens/)
    ).toBeVisible();
    await expect(page.getByText("Analyze this code for bugs")).toBeVisible();
    await expect(
      page.getByText("Here is my analysis of the code.")
    ).toBeVisible();
  });

  test("failed model event shows its error", async ({ page, network }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-error",
      content: "Partial response",
      error: "Rate limit exceeded",
    });

    await openTranscript(page, network, [modelEvent]);

    await expect(page.getByText(/^Model Call: .* · FAILED/)).toBeVisible();
    await expect(page.getByText("Rate limit exceeded")).toBeVisible();
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

    await openTranscript(page, network, [modelEvent, createToolEvent()]);

    await expect(page.getByText("Tool: Bash")).toBeVisible();
    await expect(page.getByText("total 42")).toBeVisible();
  });

  test("score event renders value and explanation", async ({
    page,
    network,
  }) => {
    const scoreEvent = createScoreEvent();

    await openTranscript(page, network, [scoreEvent]);

    await expect(page.getByText("The answer is 42")).toBeVisible();
    await expect(
      page.getByText("Correct based on the reference")
    ).toBeVisible();
    await expect(page.getByText("C", { exact: true })).toBeVisible();
  });

  test("error event renders traceback", async ({ page, network }) => {
    const errorEvent = createErrorEvent();

    await openTranscript(page, network, [errorEvent]);

    await expect(page.getByText("Error", { exact: true })).toBeVisible();
    await expect(page.getByText("result = x / 0")).toBeVisible();
  });

  test("events can be collapsed and expanded", async ({ page, network }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 0,
      endSec: 3,
      content: "Model response content here",
    });

    await openTranscript(page, network, [modelEvent]);

    const content = page.getByText("Model response content here");
    await expect(content).toBeVisible();

    await page.getByRole("button", { name: /^Collapse Model Call/ }).click();
    await expect(content).toBeHidden();

    await page.getByRole("button", { name: /^Expand Model Call/ }).click();
    await expect(content).toBeVisible();
  });

  test("toolbar Collapse hides every event body and Expand restores them", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, [
      createModelEvent({ uuid: "model-1", content: "First response" }),
      createModelEvent({
        uuid: "model-2",
        startSec: 5,
        endSec: 8,
        content: "Second response",
      }),
    ]);

    const first = page.getByText("First response");
    const second = page.getByText("Second response");
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    // The toolbar button's accessible name starts with its icon glyph.
    await page.getByRole("button", { name: /^\W*Collapse$/ }).click();
    await expect(first).toBeHidden();
    await expect(second).toBeHidden();

    await page.getByRole("button", { name: /^\W*Expand$/ }).click();
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
  });

  test("sample without timelines shows events without a swimlane", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, [
      createModelEvent({ content: "Flat event" }),
    ]);

    await expect(page.getByText("Flat event")).toBeVisible();
    await expect(
      page.getByRole("grid", { name: "Timeline swimlane" })
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Characterization: outline collapse
// ---------------------------------------------------------------------------

function createSpanBegin(
  id: string,
  name: string,
  type: string | null,
  timestamp: string
): SpanBeginEvent {
  return {
    event: "span_begin",
    id,
    name,
    type,
    parent_id: null,
    span_id: null,
    timestamp,
    working_start: 0,
    pending: null,
    uuid: `span-${id}`,
    metadata: null,
  };
}

function createSpanEnd(id: string, timestamp: string): SpanEndEvent {
  return {
    event: "span_end",
    id,
    span_id: null,
    timestamp,
    working_start: 0,
    pending: null,
    uuid: `span-end-${id}`,
    metadata: null,
  };
}

function inSpan(event: ModelEvent, spanId: string): ModelEvent {
  return { ...event, span_id: spanId };
}

test.describe("outline collapse", () => {
  // A plain (non-agent) span keeps its children in the outline tree; agent
  // spans render as childless card rows until their swimlane row is selected.
  const spanEvents = (): Events => [
    createSpanBegin("init-1", "init", null, "2025-01-15T09:59:00Z"),
    inSpan(
      createModelEvent({
        uuid: "init-model",
        content: "Setting things up",
        startSec: 0,
        endSec: 1,
      }),
      "init-1"
    ),
    createSpanEnd("init-1", "2025-01-15T09:59:30Z"),
    createSpanBegin("phase-1", "phase one", null, "2025-01-15T10:00:00Z"),
    inSpan(
      createModelEvent({
        uuid: "phase-model-1",
        content: "Research step one",
        startSec: 2,
        endSec: 4,
      }),
      "phase-1"
    ),
    inSpan(
      createModelEvent({
        uuid: "phase-model-2",
        content: "Research step two",
        startSec: 5,
        endSec: 7,
      }),
      "phase-1"
    ),
    createSpanEnd("phase-1", "2025-01-15T10:01:00Z"),
  ];

  test("span rows collapse and expand via their chevrons", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, spanEvents());

    const outline = page.locator(".transcript-outline");
    const turnsRow = outline.getByText("2 turns");
    await expect(turnsRow).toBeVisible();

    await outline
      .getByRole("button", { name: "Collapse phase one", exact: true })
      .click();
    await expect(turnsRow).toBeHidden();

    await outline
      .getByRole("button", { name: "Expand phase one", exact: true })
      .click();
    await expect(turnsRow).toBeVisible();
  });
});
