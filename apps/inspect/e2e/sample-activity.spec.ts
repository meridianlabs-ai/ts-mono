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
  testSpanBeginEvent,
  testSpanEndEvent,
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
  /** The conversation span the call belongs to (a row of its own). */
  spanId?: string;
}): ModelEvent {
  const input = overrides.inputTokens ?? 1000;
  const output = overrides.outputTokens ?? 200;
  return testModelEvent({
    uuid: overrides.uuid,
    span_id: overrides.spanId,
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
  spanId?: string;
}): CompactionEvent {
  return testCompactionEvent({
    uuid: overrides.uuid,
    span_id: overrides.spanId,
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
  // Working time is the opt-in band.
  await expect(
    page.getByText("WORKING TIME", { exact: true })
  ).not.toBeVisible();
});

test("band chips toggle the opt-in working band and default bands", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  await page.getByRole("button", { name: "Working time" }).click();
  await expect(page.getByText("WORKING TIME", { exact: true })).toBeVisible();
  // The retry-attributable stall is bracketed and labeled.
  await expect(page.getByText(/rate limit ×3/)).toBeVisible();

  await page.getByRole("button", { name: "Token burn" }).click();
  await expect(page.getByText("TOKEN BURN", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Context size" }).click();
  await expect(
    page.getByText("CONTEXT SIZE", { exact: true })
  ).not.toBeVisible();
});

test("axis toggle tiles turns and hides the working chip", async ({
  page,
  network,
}) => {
  await openSample(page, network);
  const workingChip = page.getByRole("button", { name: /Working time/ });
  const workingBand = page.getByText("WORKING TIME", { exact: true });
  await workingChip.click();
  await expect(workingBand).toBeVisible();

  await page.getByRole("button", { name: "Turns" }).click();
  await expect(page.getByText("TURN", { exact: true })).toBeVisible();
  // Three model turns → three column ticks.
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
  // Waiting has no extent on the Turns axis: chip and band both go.
  await expect(workingChip).toHaveCount(0);
  await expect(workingBand).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Markers" })).toBeVisible();

  // Back on the wall clock the chip returns still on — the override was kept.
  await page.getByRole("button", { name: "Wall clock", exact: true }).click();
  await expect(page.getByText("TURN", { exact: true })).not.toBeVisible();
  await expect(workingChip).toBeVisible();
  await expect(workingBand).toBeVisible();
});

test("hovering a span shows the tooltip card; the span itself has no click action", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  const span = page.locator("rect[class*='failedSpan']").first();
  await span.hover();
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
  // Clicking the span goes nowhere (Charles, 2026-09-16): the card's
  // footer link is the chart's only navigation.
  await expect(span).toHaveCSS("cursor", /^(auto|default)$/);
  await span.click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page).not.toHaveURL(/\/transcript/);
});

test("state outlines win over the Turns column seam in both themes", async ({
  page,
  network,
}) => {
  await openSample(page, network);
  const failed = page.locator("rect[class*='failedSpan']").first();
  const outline = () =>
    failed.evaluate((el) => {
      const style = getComputedStyle(el);
      return { stroke: style.stroke, width: style.strokeWidth };
    });
  const red = { stroke: "rgb(176, 74, 60)", width: "1px" };
  const hoverLight = { stroke: "rgb(33, 37, 41)", width: "1px" };
  const hoverDark = { stroke: "rgb(248, 249, 250)", width: "1px" };
  const redDark = { stroke: "rgb(217, 139, 127)", width: "1px" };

  // Wall clock: the failed outline at rest, the hover outline on hover.
  await expect.poll(outline).toEqual(red);
  await failed.hover();
  await expect(failed).toHaveClass(/spanHovered/);
  await expect.poll(outline).toEqual(hoverLight);

  // Turns: every column rect also carries the 1.5px body-coloured seam
  // stroke, which must not override either state outline.
  await page.getByRole("button", { name: "Turns" }).click();
  await expect(page.getByText("TURN", { exact: true })).toBeVisible();
  await expect(failed).toHaveClass(/turnRect/);
  await page.mouse.move(0, 0);
  await expect(failed).not.toHaveClass(/spanHovered/);
  await expect.poll(outline).toEqual(red);
  await failed.hover();
  await expect(failed).toHaveClass(/spanHovered/);
  await expect.poll(outline).toEqual(hoverLight);

  // Dark theme is the `data-bs-theme` attribute the theme bootstrap writes
  // on <html>; the same precedence must hold there.
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-bs-theme", "dark");
  });
  await expect.poll(outline).toEqual(hoverDark);
  await page.mouse.move(0, 0);
  await expect(failed).not.toHaveClass(/spanHovered/);
  await expect.poll(outline).toEqual(redDark);
});

/** `turns` one-second model calls 100 s apart; turn 1 also runs `tools`
 *  sequential one-second tool calls — the narrow-column Turns shapes. */
function narrowTurnsEvents(turns: number, tools: number): Events {
  return [
    activityModelEvent({ uuid: "m0", startSec: 0, endSec: 1, workingStart: 0 }),
    ...Array.from({ length: tools }, (_, i) =>
      activityToolEvent({
        uuid: `t${i}`,
        startSec: 2 + i * 2,
        endSec: 3 + i * 2,
        workingStart: 2 + i * 2,
      })
    ),
    ...Array.from({ length: turns - 1 }, (_, i) =>
      activityModelEvent({
        uuid: `m${i + 1}`,
        startSec: 100 * (i + 1),
        endSec: 100 * (i + 1) + 1,
        workingStart: 100 * (i + 1),
      })
    ),
  ];
}

const kToolTealLight = "rgb(20, 184, 166)";
const kToolTealDark = "rgb(45, 212, 191)";

/** The plot's width, read from the widest horizontal axis line. */
const plotWidth = (page: Page) =>
  page.locator("line[class*='axisLine']").evaluateAll((lines) =>
    Math.max(
      ...lines.map((line) => {
        const y1 = line.getAttribute("y1");
        const y2 = line.getAttribute("y2");
        if (y1 !== y2) return 0;
        return (
          Number(line.getAttribute("x2")) - Number(line.getAttribute("x1"))
        );
      })
    )
  );

const toDark = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.setAttribute("data-bs-theme", "dark");
  });

// A 1032 px viewport gives the 960 px plot where the global 3 px-per-turn
// density threshold sits at exactly 320 turns: `turnsDense` is false at
// equality and a tool half there is 1.5 px — entirely under the 1.5 px
// seam stroke. 300 turns leaves ~0.1 px of teal.
for (const turns of [320, 300]) {
  test(`a ${turns}-turn Turns chart degrades to the strip before its tool half vanishes under the seam`, async ({
    page,
    network,
  }) => {
    await page.setViewportSize({ width: 1032, height: 900 });
    await openSample(page, network, { events: narrowTurnsEvents(turns, 4) });
    await page.getByRole("button", { name: "Turns", exact: true }).click();
    await expect(page.getByText("TURN", { exact: true })).toBeVisible();
    expect(Math.abs((await plotWidth(page)) - 960)).toBeLessThan(1);
    await expect(page.locator("rect[class*='toolSpan']")).toHaveCount(0);
    await expect(page.locator("rect[class*='turnRect']")).toHaveCount(0);
    await expect(page.getByText(/per-pixel occupancy/)).toBeVisible();
    // Turn 1 (one model call, four tools) is a tool-majority strip column
    // in the tool teal, in both themes.
    const column = page.locator("rect[class*='densityTool']").first();
    await expect(column).toBeVisible();
    const fill = () => column.evaluate((el) => getComputedStyle(el).fill);
    await expect.poll(fill).toBe(kToolTealLight);
    await toDark(page);
    await expect.poll(fill).toBe(kToolTealDark);
    await expect(page.locator("rect[class*='toolSpan']")).toHaveCount(0);
  });
}

test("a tool half that keeps the tick floor under its seam stays a discrete rect in both themes", async ({
  page,
  network,
}) => {
  await page.setViewportSize({ width: 1032, height: 900 });
  await openSample(page, network, { events: narrowTurnsEvents(100, 1) });
  await page.getByRole("button", { name: "Turns", exact: true }).click();
  await expect(page.getByText("TURN", { exact: true })).toBeVisible();
  const tool = page.locator("rect[class*='toolSpan']");
  await expect(tool).toHaveCount(1);
  await expect(page.locator("rect[class*='densityTool']")).toHaveCount(0);
  // Visible teal = the rect's width minus the seam stroke it carries.
  const paint = () =>
    tool.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fill: style.fill,
        visible:
          Number(el.getAttribute("width")) - parseFloat(style.strokeWidth),
      };
    });
  const light = await paint();
  expect(light.fill).toBe(kToolTealLight);
  expect(light.visible).toBeGreaterThanOrEqual(3);
  await toDark(page);
  await expect.poll(async () => (await paint()).fill).toBe(kToolTealDark);
  expect((await paint()).visible).toBeGreaterThanOrEqual(3);
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

// A human hand does not jump 25 px per event: it crosses the gap between
// the span and the card's footer in small moves, down and to the right,
// over the Context / Token bands beside the card. Every step must still
// show the same card, or the link can never be reached (round 12).
for (const axis of ["Wall clock", "Turns"] as const) {
  test(`the span tooltip survives a slow diagonal path across the curve bands to its footer (${axis})`, async ({
    page,
    network,
  }) => {
    await openSample(page, network);
    if (axis === "Turns") {
      await page.getByRole("button", { name: "Turns", exact: true }).click();
      await expect(page.getByText("TURN", { exact: true })).toBeVisible();
    }

    const span = page.locator("rect[class*='failedSpan']").first();
    await span.hover();
    const card = page.locator("[class*='tooltip']");
    await expect(card).toContainText("bash tool call");
    const footer = card.getByRole("button", { name: "open in transcript →" });
    await expect(footer).toBeVisible();

    const spanBox = await span.boundingBox();
    const footerBox = await footer.boundingBox();
    if (!spanBox || !footerBox) throw new Error("expected span and footer");
    const from = {
      x: spanBox.x + spanBox.width / 2,
      y: spanBox.y + spanBox.height / 2,
    };
    const to = {
      x: footerBox.x + footerBox.width / 2,
      y: footerBox.y + footerBox.height / 2,
    };
    // Twenty moves of a few px each; the assertion between them paces the
    // journey at roughly human speed and pins the card at every step.
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps
      );
      await expect(card, `step ${i}`).toContainText("bash tool call");
    }
    await footer.click();
    await expect(page).toHaveURL(/\/transcript\?event=tool-fail/);
  });
}

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

test("marker glyph click is inert; its card's footer navigates", async ({
  page,
  network,
}) => {
  await openSample(page, network);

  // Narrow to Scores so the error row is filtered out…
  await page.getByRole("button", { name: /Scores/ }).click();
  await expect(page.getByText(/exit 127/)).not.toBeVisible();

  // …clicking the error glyph changes nothing: the filter stays narrow and
  // the URL stays put. Its hover card still carries the way through.
  const glyph = page.getByRole("button", { name: "Tool bash errored" });
  await glyph.click();
  await expect(page.getByText(/exit 127/)).not.toBeVisible();
  await expect(page).toHaveURL(/\/activity$/);
  await glyph.hover();
  const card = page.locator("[class*='tooltip']");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "open in transcript →" }).click();
  await expect(page).toHaveURL(/\/transcript\?event=/);
});

// Charles, 2026-09-16: the chart has no click actions. Marker hit rects stay
// focusable for keyboard access to the card, which needs no pointer cursor;
// the density strip has no action at all. The unit suite's `noPointerCursor`
// reads the module css; these read the browser's computed style.
const kInertCursor = /^(auto|default)$/;

test("a marker glyph shows the default cursor in both axis modes", async ({
  page,
  network,
}) => {
  await openSample(page, network);
  // The history row shares the glyph's name; the glyph is the rail's rect.
  const glyph = page
    .getByRole("button", { name: "Tool bash errored" })
    .and(page.locator("rect"));
  await expect(glyph).toBeVisible();
  await expect(glyph).toHaveCSS("cursor", kInertCursor);
  await page.getByRole("button", { name: "Turns", exact: true }).click();
  await expect(page.getByText("TURN", { exact: true })).toBeVisible();
  await expect(glyph).toHaveCSS("cursor", kInertCursor);
});

test("a density-strip column shows the default cursor in both axis modes", async ({
  page,
  network,
}) => {
  await page.setViewportSize({ width: 1032, height: 900 });
  // 324 spans on a 960 px plot: past the 3 px-per-span threshold on the
  // wall clock as well as in Turns, so both strips render.
  await openSample(page, network, { events: narrowTurnsEvents(320, 4) });
  await expect(page.getByText(/per-pixel occupancy/)).toBeVisible();
  const column = page.locator("rect[class*='densityHit']").first();
  await expect(column).toBeVisible();
  await expect(column).toHaveCSS("cursor", kInertCursor);
  await page.getByRole("button", { name: "Turns", exact: true }).click();
  await expect(page.getByText("TURN", { exact: true })).toBeVisible();
  await expect(column).toBeVisible();
  await expect(column).toHaveCSS("cursor", kInertCursor);
});

// Charles, 2026-09-16: a card that stands for a collapsed range still links
// to the transcript — at the first event in the range.
for (const axis of ["Wall clock", "Turns"] as const) {
  test(`a density-strip bin's card links to the first call in the bin (${axis})`, async ({
    page,
    network,
  }) => {
    await page.setViewportSize({ width: 1032, height: 900 });
    await openSample(page, network, { events: narrowTurnsEvents(320, 4) });
    await expect(page.getByText(/per-pixel occupancy/)).toBeVisible();
    if (axis === "Turns") {
      await page.getByRole("button", { name: "Turns", exact: true }).click();
      await expect(page.getByText("TURN", { exact: true })).toBeVisible();
    }
    const column = page.locator("rect[class*='densityHit']").first();
    const box = await column.boundingBox();
    if (!box) throw new Error("expected the strip's hit rect");
    // The first bin: m0, its four tools and the next few turns' calls.
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    const card = page.locator("[class*='tooltip']");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/\d+ model calls · 4 tool calls/);
    await expect(card).toContainText(
      axis === "Turns" ? /turns 1–\d+ · / : /\d+:\d\d:\d\d [AP]M → /
    );
    await card
      .getByRole("button", { name: "open first in transcript →" })
      .click();
    await expect(page).toHaveURL(/\/transcript\?event=m0$/);
  });
}

/** A call, three issued together (one start, different context sizes and
 *  completions), then one more: the fan-out whose Wall clock vertex
 *  carries a range card. */
function fanOutEvents(): Events {
  return [
    activityModelEvent({
      uuid: "m0",
      startSec: 0,
      endSec: 5,
      workingStart: 0,
      inputTokens: 1_000,
    }),
    activityModelEvent({
      uuid: "fan-a",
      startSec: 20,
      endSec: 35,
      workingStart: 20,
      inputTokens: 14_700,
    }),
    activityModelEvent({
      uuid: "fan-b",
      startSec: 20,
      endSec: 25,
      workingStart: 20,
      inputTokens: 9_840,
    }),
    activityModelEvent({
      uuid: "fan-c",
      startSec: 20,
      endSec: 30,
      workingStart: 20,
      inputTokens: 12_000,
    }),
    activityModelEvent({
      uuid: "m4",
      startSec: 40,
      endSec: 45,
      workingStart: 40,
      inputTokens: 16_000,
    }),
  ];
}

/** Walk the pointer from `from` to `to` in `steps` moves, checking the
 *  card between moves — the assertion paces the journey at roughly human
 *  speed and pins the card at every step. */
async function travel(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
  check: (step: number) => Promise<void>
) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
    await check(i);
  }
}

const center = (box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

// A fan-out's Wall clock vertex carries a range card (review pass 15): its
// footer must survive ordinary pointer travel off the 6 px snap radius —
// small steps straight at the footer, or a first leg down out of the
// radius before the diagonal — not only a direct click on a fresh card.
for (const path of ["straight", "down then across"] as const) {
  test(`the fan-out vertex card survives pointer travel to its footer (${path})`, async ({
    page,
    network,
  }) => {
    await openSample(page, network, { events: fanOutEvents() });
    await expect(page.getByText("CONTEXT SIZE", { exact: true })).toBeVisible();
    const dotBox = await page
      .locator("circle[class*='contextDot']")
      .nth(1)
      .boundingBox();
    if (!dotBox) throw new Error("expected the fan-out's context dot");
    const from = center(dotBox);
    await page.mouse.move(from.x, from.y);
    const card = page.locator("[class*='tooltip']");
    await expect(card).toContainText("3 parallel calls");
    const footer = card.getByRole("button", {
      name: "open first in transcript →",
    });
    await expect(footer).toBeVisible();
    const footerBox = await footer.boundingBox();
    if (!footerBox) throw new Error("expected the card's footer");
    const to = center(footerBox);
    const legs =
      path === "straight"
        ? [{ to, steps: 30 }]
        : [
            { to: { x: from.x + 4, y: from.y + 14 }, steps: 6 },
            { to, steps: 24 },
          ];
    let at = from;
    for (const leg of legs) {
      await travel(page, at, leg.to, leg.steps, async (step) => {
        await expect(card, `${path} step ${step}`).toContainText(
          "3 parallel calls"
        );
      });
      at = leg.to;
    }
    await footer.click();
    await expect(page).toHaveURL(/\/transcript\?event=fan-b$/);
  });
}

/** Two conversations, each dense enough for the strip at a 1032 px
 *  viewport, the first with a two-compaction cluster on the rail: the
 *  multi-row shape whose footer travel crosses another row's hit
 *  surfaces. */
function twoDenseRowsEvents(): Events {
  const events: Events = [];
  for (const [agent, offset] of [
    ["agentA", 0],
    ["agentB", 1000],
  ] as const) {
    events.push(
      testSpanBeginEvent({
        id: agent,
        name: agent,
        type: "agent",
        timestamp: iso(offset),
        working_start: offset,
      })
    );
    for (let i = 0; i < 330; i++) {
      const start = offset + i * 2;
      events.push(
        activityModelEvent({
          uuid: `${agent}-m${i}`,
          startSec: start,
          endSec: start + 1,
          workingStart: start,
          inputTokens: 1_000 + i * 10,
          spanId: agent,
        })
      );
      if (agent === "agentA" && (i === 50 || i === 51)) {
        events.push(
          activityCompactionEvent({
            uuid: `compact-a${i - 49}`,
            atSec: start + 1.5,
            workingStart: start + 1.5,
            before: 1_000 + i * 10,
            after: 500,
            spanId: agent,
          })
        );
      }
    }
    events.push(
      testSpanEndEvent({
        id: agent,
        timestamp: iso(offset + 660),
        working_start: offset + 660,
      })
    );
  }
  return events;
}

// A range card's footer sits below the whole activity band, so on a
// multi-row chart the pointer crosses the lower rows' strips on the way
// (review pass 15): the card must not change hands mid-journey.
for (const axis of ["Wall clock", "Turns"] as const) {
  test(`a first-row bin card survives travel across the second row's strip to its footer (${axis})`, async ({
    page,
    network,
  }) => {
    await page.setViewportSize({ width: 1032, height: 900 });
    await openSample(page, network, { events: twoDenseRowsEvents() });
    await expect(page.getByText(/per-pixel occupancy/)).toBeVisible();
    if (axis === "Turns") {
      await page.getByRole("button", { name: "Turns", exact: true }).click();
      await expect(page.getByText("TURN", { exact: true })).toBeVisible();
    }
    const strips = page.locator("rect[class*='densityHit']");
    await expect(strips).toHaveCount(2);
    const box = await strips.first().boundingBox();
    if (!box) throw new Error("expected the first row's strip");
    const from = { x: box.x + 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    const card = page.locator("[class*='tooltip']");
    await expect(card).toContainText(/[1-9]\d* model calls · 0 tool calls/);
    const subject = /[1-9]\d* model calls · 0 tool calls/.exec(
      (await card.textContent()) ?? ""
    )?.[0];
    if (!subject) throw new Error("expected the first row's bin card");
    const footer = card.getByRole("button", {
      name: "open first in transcript →",
    });
    await expect(footer).toBeVisible();
    const footerBox = await footer.boundingBox();
    if (!footerBox) throw new Error("expected the card's footer");
    await travel(page, from, center(footerBox), 30, async (step) => {
      await expect(card, `${axis} step ${step}`).toContainText(subject);
    });
    await footer.click();
    await expect(page).toHaveURL(/\/transcript\?event=agentA-m0$/);
  });
}

test("a marker cluster's card survives travel across the strips to its footer", async ({
  page,
  network,
}) => {
  await page.setViewportSize({ width: 1032, height: 900 });
  await openSample(page, network, { events: twoDenseRowsEvents() });
  await expect(page.getByText(/per-pixel occupancy/)).toBeVisible();
  const glyph = page
    .getByRole("button", { name: /^2 events: Context compacted/ })
    .and(page.locator("rect"));
  await glyph.hover();
  const card = page.locator("[class*='tooltip']");
  await expect(card).toContainText("2 events");
  const footer = card.getByRole("button", {
    name: "open first in transcript →",
  });
  await expect(footer).toBeVisible();
  const glyphBox = await glyph.boundingBox();
  const footerBox = await footer.boundingBox();
  if (!glyphBox || !footerBox) throw new Error("expected glyph and footer");
  // Down from the rail through both rows' strips to the footer.
  await travel(page, center(glyphBox), center(footerBox), 30, async (step) => {
    await expect(card, `step ${step}`).toContainText("2 events");
  });
  await footer.click();
  await expect(page).toHaveURL(/\/transcript\?event=compact-a1$/);
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
