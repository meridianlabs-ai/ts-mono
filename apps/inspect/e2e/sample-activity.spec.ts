/**
 * Sample Activity tab e2e tests.
 *
 * Exercises the new Activity tab in the sample display: tab presence,
 * band rendering, band chips, history-list filters, marker → row selection,
 * and click-through to the Transcript. Also covers the companion label-only
 * rename of the log-level Timeline tab to "Activity".
 */

import { http, HttpResponse } from "msw";

import type {
  CompactionEvent,
  EvalSample,
  ModelEvent,
  ModelOutput,
  ScoreEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createModelOutput,
} from "./fixtures/test-data";

const LOG_FILE = "test-sample-activity.json";

type Events = EvalSample["events"];

const kRunStart = Date.parse("2025-01-15T10:00:00.000Z") / 1000;
const iso = (sec: number): string =>
  new Date((kRunStart + sec) * 1000).toISOString();

// ---------------------------------------------------------------------------
// Event factories
// ---------------------------------------------------------------------------

function activityModelEvent(overrides: {
  uuid: string;
  startSec: number;
  endSec: number;
  workingStart: number;
  inputTokens?: number;
  outputTokens?: number;
  retries?: number;
  /** Working seconds within the wall span (defaults to the whole span). */
  working?: number;
}): ModelEvent {
  const input = overrides.inputTokens ?? 1000;
  const output = overrides.outputTokens ?? 200;
  const modelOutput: ModelOutput = {
    ...createModelOutput("Model response"),
    usage: {
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
    },
  };
  return {
    event: "model",
    uuid: overrides.uuid,
    model: "claude-sonnet-4-5-20250929",
    input: [],
    output: modelOutput,
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: iso(overrides.startSec),
    completed: iso(overrides.endSec),
    working_start: overrides.workingStart,
    working_time: overrides.working ?? overrides.endSec - overrides.startSec,
    retries: overrides.retries,
  };
}

function activityToolEvent(overrides: {
  uuid: string;
  startSec: number;
  endSec: number;
  workingStart: number;
  fn?: string;
  errorMessage?: string;
}): ToolEvent {
  return {
    event: "tool",
    uuid: overrides.uuid,
    id: overrides.uuid,
    type: "function",
    function: overrides.fn ?? "bash",
    arguments: {},
    result: "",
    events: [],
    timestamp: iso(overrides.startSec),
    completed: iso(overrides.endSec),
    working_start: overrides.workingStart,
    working_time: overrides.endSec - overrides.startSec,
    error: overrides.errorMessage
      ? { type: "unknown", message: overrides.errorMessage }
      : undefined,
  };
}

function activityCompactionEvent(overrides: {
  uuid: string;
  atSec: number;
  workingStart: number;
  before: number;
  after: number;
}): CompactionEvent {
  return {
    event: "compaction",
    uuid: overrides.uuid,
    type: "summary",
    timestamp: iso(overrides.atSec),
    working_start: overrides.workingStart,
    tokens_before: overrides.before,
    tokens_after: overrides.after,
  };
}

function activityScoreEvent(overrides: {
  uuid: string;
  atSec: number;
  workingStart: number;
}): ScoreEvent {
  return {
    event: "score",
    uuid: overrides.uuid,
    intermediate: false,
    score: { value: 1, history: [] },
    scorer: "activity_scorer",
    timestamp: iso(overrides.atSec),
    working_start: overrides.workingStart,
  };
}

/** A sample with working gaps, a retrying model call, a failed tool call,
 *  a compaction, and a score — every Activity surface has something on it. */
function activityEvents(): Events {
  return [
    activityModelEvent({
      uuid: "model-1",
      startSec: 0,
      endSec: 10,
      workingStart: 0,
      inputTokens: 5_000,
    }),
    // Retrying call: 30s of wall clock, 5s of work — a 25s stall inside.
    activityModelEvent({
      uuid: "model-retry",
      startSec: 10,
      endSec: 40,
      workingStart: 10,
      working: 5,
      retries: 3,
      inputTokens: 20_000,
    }),
    activityToolEvent({
      uuid: "tool-ok",
      startSec: 40,
      endSec: 44,
      workingStart: 15,
    }),
    activityToolEvent({
      uuid: "tool-fail",
      startSec: 44,
      endSec: 48,
      workingStart: 19,
      errorMessage: "exit 127",
    }),
    activityCompactionEvent({
      uuid: "compact-1",
      atSec: 50,
      workingStart: 23,
      before: 142_000,
      after: 38_000,
    }),
    activityModelEvent({
      uuid: "model-2",
      startSec: 52,
      endSec: 60,
      workingStart: 23,
      inputTokens: 38_000,
    }),
    activityScoreEvent({ uuid: "score-1", atSec: 62, workingStart: 31 }),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Page = Parameters<Parameters<typeof test>[2]>[0]["page"];
type Network = Parameters<Parameters<typeof test>[2]>[0]["network"];

async function openSample(
  page: Page,
  network: Network,
  options?: { events?: Events; tab?: string }
) {
  const events = options?.events ?? activityEvents();
  const sample = createEvalSample({
    id: 1,
    epoch: 1,
    messages: [
      { role: "user", content: "Hello", source: "input" },
      { role: "assistant", content: "Hi there", source: "generate" },
    ],
    events,
  });
  const evalLog = createEvalLog({ samples: [sample] });

  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () => {
      return HttpResponse.json({
        files: [{ name: LOG_FILE, task: "chat-test", task_id: "chat-test" }],
        response_type: "full",
      });
    }),
    http.get("*/api/logs/:file", () => HttpResponse.json(evalLog)),
    http.get("*/api/log-headers*", () => {
      return HttpResponse.json([
        {
          eval_id: evalLog.eval.eval_id,
          run_id: evalLog.eval.run_id,
          task: evalLog.eval.task,
          task_id: evalLog.eval.task_id,
          task_version: evalLog.eval.task_version,
          model: evalLog.eval.model,
          status: evalLog.status,
          started_at: evalLog.stats.started_at,
          completed_at: evalLog.stats.completed_at,
        },
      ]);
    })
  );

  const encodedFile = encodeURIComponent(LOG_FILE);
  await page.goto(
    `/#/logs/${encodedFile}/samples/sample/1/1/${options?.tab ?? "activity"}`
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("activity tab appears and its default bands render", async ({
  page,
  network,
}) => {
  await openSample(page, network, { tab: "transcript" });

  const activityTab = page.getByRole("tab", { name: "Activity" });
  await expect(activityTab).toBeVisible();
  await activityTab.click();

  // Curated default-on bands.
  await expect(
    page.getByText("WORKING / WAITING", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("TOKEN BURN", { exact: true })).toBeVisible();
  // The retry-attributable stall is bracketed and labeled.
  await expect(page.getByText(/rate limit ×3/)).toBeVisible();
  // Opt-in bands stay off by default.
  await expect(
    page.getByText("CONTEXT SIZE", { exact: true })
  ).not.toBeVisible();
  await expect(
    page.getByText("MODEL & TOOL ACTIVITY", { exact: true })
  ).not.toBeVisible();
});

test("band chips toggle opt-in bands", async ({ page, network }) => {
  await openSample(page, network);

  await page.getByRole("button", { name: "Context size" }).click();
  await expect(page.getByText("CONTEXT SIZE", { exact: true })).toBeVisible();
  // Compaction annotated as a cliff drop.
  await expect(page.getByText("142k → 38k").first()).toBeVisible();

  await page.getByRole("button", { name: "Model & tool activity" }).click();
  await expect(
    page.getByText("MODEL & TOOL ACTIVITY", { exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "Token burn" }).click();
  await expect(page.getByText("TOKEN BURN", { exact: true })).not.toBeVisible();
});

test("history list filters by category pill and search", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  // All incident rows render.
  await expect(page.getByText(/exit 127/)).toBeVisible();
  await expect(page.getByText(/scorer activity_scorer/)).toBeVisible();

  // Errors pill narrows to error rows (failed tool + rate-limit stall).
  await page.getByRole("button", { name: /Errors/ }).click();
  await expect(page.getByText(/exit 127/)).toBeVisible();
  await expect(page.getByText(/scorer activity_scorer/)).not.toBeVisible();

  // All resets; search narrows.
  await page.getByRole("button", { name: /All/ }).click();
  await page.getByPlaceholder("filter by event or detail").fill("compacted");
  await expect(page.getByText("Context compacted")).toBeVisible();
  await expect(page.getByText(/exit 127/)).not.toBeVisible();
});

test("marker click selects and reveals its history row", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  // Narrow to Scores so the error row is filtered out…
  await page.getByRole("button", { name: /Scores/ }).click();
  await expect(page.getByText(/exit 127/)).not.toBeVisible();

  // …then click the error glyph: the filter widens and the row appears.
  await page.getByRole("button", { name: "Tool bash errored" }).click();
  await expect(page.getByText(/exit 127/)).toBeVisible();
});

test("history row clicks through to the transcript event", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  await page
    .getByRole("button", { name: "open in transcript →" })
    .first()
    .click();

  await expect(page).toHaveURL(/\/transcript\?event=/);
  // The transcript panel is showing.
  await expect(page.getByRole("tab", { name: "Transcript" })).toBeVisible();
});

test("activity tab is hidden for old logs without event timestamps", async ({
  page,
  network,
}) => {
  const legacyEvents: Events = activityEvents().map((event) => ({
    ...event,
    timestamp: "",
    ...("completed" in event ? { completed: null } : {}),
  }));
  // Deep-link straight to /activity: a shared Activity URL opened on a log
  // whose tab is hidden must fall back to the Transcript, not go blank.
  await openSample(page, network, {
    events: legacyEvents,
    tab: "activity",
  });

  await expect(page.getByRole("tab", { name: "Transcript" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Activity" })).not.toBeVisible();
  await expect(page.locator("#transcript-contents")).toBeVisible();
});

test("log-level tab is relabeled Activity", async ({ page, network }) => {
  await openSample(page, network, { tab: "transcript" });

  const encodedFile = encodeURIComponent(LOG_FILE);
  await page.goto(`/#/logs/${encodedFile}`);
  await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible();
});
