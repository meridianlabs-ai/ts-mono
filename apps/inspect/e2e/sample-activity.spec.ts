/**
 * Sample Activity tab e2e tests.
 *
 * Exercises the new Activity tab in the sample display: tab presence,
 * band rendering, band chips, history-list filters, marker → row selection,
 * and click-through to the Transcript. Also covers the companion label-only
 * rename of the log-level Timeline tab to "Activity".
 */

import { http, HttpResponse } from "msw";

import {
  testCompactionEvent,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testScore,
  testScoreEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type {
  CompactionEvent,
  EvalSample,
  ModelEvent,
  ScoreEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

const LOG_FILE = "test-sample-activity.json";

type Events = EvalSample["events"];

const kRunStart = Date.parse("2025-01-15T10:00:00.000Z") / 1000;
const iso = (sec: number): string =>
  new Date((kRunStart + sec) * 1000).toISOString();

// ---------------------------------------------------------------------------
// Event factories — thin wrappers over the shared builders that fix the
// run-relative wall clock and working clock the Activity assertions read.
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
  return testModelEvent({
    uuid: overrides.uuid,
    model: "claude-sonnet-4-5-20250929",
    output: testModelOutput({
      usage: testModelUsage({
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
      }),
    }),
    timestamp: iso(overrides.startSec),
    completed: iso(overrides.endSec),
    working_start: overrides.workingStart,
    working_time: overrides.working ?? overrides.endSec - overrides.startSec,
    retries: overrides.retries,
  });
}

function activityToolEvent(overrides: {
  uuid: string;
  startSec: number;
  endSec: number;
  workingStart: number;
  fn?: string;
  errorMessage?: string;
}): ToolEvent {
  return testToolEvent({
    uuid: overrides.uuid,
    id: overrides.uuid,
    function: overrides.fn ?? "bash",
    timestamp: iso(overrides.startSec),
    completed: iso(overrides.endSec),
    working_start: overrides.workingStart,
    working_time: overrides.endSec - overrides.startSec,
    error: overrides.errorMessage
      ? { type: "unknown", message: overrides.errorMessage }
      : undefined,
  });
}

function activityCompactionEvent(overrides: {
  uuid: string;
  atSec: number;
  workingStart: number;
  before: number;
  after: number;
}): CompactionEvent {
  return testCompactionEvent({
    uuid: overrides.uuid,
    timestamp: iso(overrides.atSec),
    working_start: overrides.workingStart,
    tokens_before: overrides.before,
    tokens_after: overrides.after,
  });
}

function activityScoreEvent(overrides: {
  uuid: string;
  atSec: number;
  workingStart: number;
}): ScoreEvent {
  return testScoreEvent({
    uuid: overrides.uuid,
    score: testScore({ value: 1 }),
    scorer: "activity_scorer",
    timestamp: iso(overrides.atSec),
    working_start: overrides.workingStart,
  });
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

  // Curated default-on bands (handoff 8a): activity, context, token burn.
  await expect(
    page.getByText("MODEL & TOOL ACTIVITY", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("CONTEXT SIZE", { exact: true })).toBeVisible();
  await expect(page.getByText("TOKEN BURN", { exact: true })).toBeVisible();
  // Compaction annotated as a cliff drop.
  await expect(page.getByText("142k → 38k").first()).toBeVisible();
  // Working / waiting is the opt-in band.
  await expect(
    page.getByText("WORKING / WAITING", { exact: true })
  ).not.toBeVisible();
});

test("band chips toggle the opt-in working band and default bands", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  await page.getByRole("button", { name: "Working / waiting" }).click();
  await expect(
    page.getByText("WORKING / WAITING", { exact: true })
  ).toBeVisible();
  // The retry-attributable stall is bracketed and labeled.
  await expect(page.getByText(/rate limit ×3/)).toBeVisible();

  await page.getByRole("button", { name: "Token burn" }).click();
  await expect(page.getByText("TOKEN BURN", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Context size" }).click();
  await expect(
    page.getByText("CONTEXT SIZE", { exact: true })
  ).not.toBeVisible();
});

test("axis toggle tiles turns and greys the working chip", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  await page.getByRole("button", { name: "Turns" }).click();
  await expect(page.getByText("TURN", { exact: true })).toBeVisible();
  // Three model turns → three column ticks.
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
  const workingChip = page.getByRole("button", { name: /Working \/ waiting/ });
  await expect(workingChip).toBeDisabled();
  await expect(workingChip).toContainText("wall clock only");

  await page.getByRole("button", { name: "Wall clock", exact: true }).click();
  await expect(page.getByText("TURN", { exact: true })).not.toBeVisible();
  await expect(workingChip).toBeEnabled();
});

test("hovering a span shows the tooltip card with click-through", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  await page.locator("rect[class*='failedSpan']").first().hover();
  const card = page.locator("[class*='tooltip']");
  await expect(card).toBeVisible();
  await expect(card).toContainText("bash tool call");
  await expect(card).toContainText("failed");
  await expect(card).toContainText("exit 127");
  await expect(
    card.getByRole("button", { name: "open in transcript →" })
  ).toBeVisible();
  // Shared cursor: the axis pill pins the hovered span's start.
  await expect(page.locator("[class*='cursorPillText']")).toBeVisible();
});

test("the tooltip survives pointer travel from the span to its footer", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  const span = page.locator("rect[class*='failedSpan']").first();
  await span.hover();
  const card = page.locator("[class*='tooltip']");
  await expect(card).toBeVisible();
  const footer = card.getByRole("button", { name: "open in transcript →" });
  await expect(footer).toBeVisible();

  // Physically travel from the span, across the band below it, into the
  // card's footer — the card sits under the whole activity band, so the
  // pointer crosses empty plot on the way. The card's real 300ms grace
  // starts when the pointer leaves the span, so everything that can be
  // awaited beforehand (the boxes) is, and the two legs of the journey
  // run back to back with no assertion between them.
  const spanBox = await span.boundingBox();
  const footerBox = await footer.boundingBox();
  if (!spanBox || !footerBox) throw new Error("expected span and footer");
  await page.mouse.move(
    spanBox.x + spanBox.width / 2,
    spanBox.y + spanBox.height + 5,
    { steps: 3 }
  );
  await page.mouse.move(
    footerBox.x + footerBox.width / 2,
    footerBox.y + footerBox.height / 2,
    { steps: 6 }
  );
  await expect(footer).toBeVisible();
  await footer.click();
  await expect(page).toHaveURL(/\/transcript\?event=tool-fail/);
});

test("the span tooltip follows the pointer horizontally", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  const span = page.locator("rect[class*='modelSpan']").first();
  const box = await span.boundingBox();
  if (!box) throw new Error("expected a model span");
  await span.hover({ position: { x: box.width * 0.25, y: box.height / 2 } });
  const card = page.locator("[class*='tooltip']");
  await expect(card).toBeVisible();
  const before = await card.boundingBox();

  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, {
    steps: 4,
  });
  await expect
    .poll(async () => (await card.boundingBox())?.x)
    .toBeGreaterThan((before?.x ?? 0) + box.width * 0.4);
  // The hairline stays anchored to the span start while the card moves.
  await expect(page.locator("[class*='cursorPillText']")).toBeVisible();
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
  // Logs that predate event timestamps also predate compaction events —
  // and CompactionEventView formats its timestamp unconditionally, so a
  // blank one throws into the transcript's error boundary and the
  // transcript intermittently fails to mount.
  const legacyEvents: Events = activityEvents()
    .filter((event) => event.event !== "compaction")
    .map((event) => ({
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
