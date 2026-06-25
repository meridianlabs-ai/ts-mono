/**
 * E2E coverage for transcript turn navigation: j/k keyboard stepping, the
 * header turn chevrons + open-in-new-tab control, and the standalone
 * single-event page.
 */
import { http, HttpResponse } from "msw";

import type {
  ChatMessage,
  EvalSample,
  ModelEvent,
  ModelOutput,
} from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
  createModelOutput,
} from "./fixtures/test-data";

const LOG_FILE = "test-turnnav.json";
type Events = EvalSample["events"];

function createModelEvent(uuid: string, content: string): ModelEvent {
  const output: ModelOutput = {
    ...createModelOutput(content),
    usage: { input_tokens: 60, output_tokens: 40, total_tokens: 100 },
    time: 3,
  };
  return {
    event: "model",
    uuid,
    model: "claude-sonnet-4-5-20250929",
    input: [{ role: "user", content: "Question", id: null }],
    output,
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: "2025-01-15T10:00:00Z",
    working_start: 0,
    working_time: 3,
    error: null,
    traceback_ansi: null,
  };
}

async function openTranscript(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  events: Events
) {
  const messages: ChatMessage[] = [];
  const sample = createEvalSample({ id: 1, epoch: 1, messages });
  (sample as { events: Events }).events = events;
  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: "turnnav", task_id: "turnnav" }],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", () => HttpResponse.json(evalLog)),
    http.get("*/api/log-headers*", () =>
      HttpResponse.json([
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
      ])
    )
  );

  const encodedFile = encodeURIComponent(LOG_FILE);
  await page.goto(`/#/logs/${encodedFile}/samples/sample/1/1/transcript`);
}

const longBody = (label: string) =>
  `${label}. ` + "Lorem ipsum dolor sit amet. ".repeat(40);

const threeTurns: Events = [
  createModelEvent("turn-a", longBody("First turn response")),
  createModelEvent("turn-b", longBody("Second turn response")),
  createModelEvent("turn-c", longBody("Third turn response")),
];

// Many tall turns so the list virtualizes: off-screen rows keep the 400px
// estimated height (DEFAULT_ITEM_HEIGHT_PX) rather than their measured height.
// That estimate/measure gap is what makes a naive scrollToIndex land in
// different places depending on scroll history (the re-navigation drift below).
// Heights vary wildly between turns (some a few lines, some enormous) so the
// 400px estimate is wrong by a *different* amount per row. That makes
// scrollToIndex's cumulative-estimate math path-dependent: scrolling to a turn
// from far vs from nearby measures a different set of rows and lands the target
// in a different spot — uniform-height rows wouldn't expose it.
const varyBody = (label: string, lines: number) =>
  `${label}. ` + "Lorem ipsum dolor sit amet consectetur. ".repeat(lines);

const manyTurns: Events = Array.from({ length: 20 }, (_, i) =>
  createModelEvent(
    `turn-${String(i).padStart(2, "0")}`,
    varyBody(`Turn ${i} response`, [3, 160, 8, 220, 30, 120][i % 6])
  )
);

// Top of `#<eventId>` relative to the top of its scroll container, in px.
async function eventTopInScroller(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  eventId: string
): Promise<number> {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return Number.NaN;
    let sc: HTMLElement | null = el;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) {
      sc = sc.parentElement;
    }
    const scTop = sc ? sc.getBoundingClientRect().top : 0;
    return el.getBoundingClientRect().top - scTop;
  }, eventId);
}

test.describe("transcript turn navigation", () => {
  test("turn header shows always-visible nav chevrons + open-in-new-tab", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, threeTurns);
    await expect(page.getByText("turn 1/3").first()).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Next turn" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Previous turn" }).first()
    ).toBeVisible();

    const openLink = page
      .getByRole("link", { name: "Open turn in new tab" })
      .first();
    await expect(openLink).toHaveAttribute("href", /\/event\?event=/);

    await page.screenshot({
      path: "test-results/turn-nav-chevrons.png",
      fullPage: false,
    });
  });

  test("k scrolls to the next turn (no persistent selection)", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, threeTurns);
    await expect(page.getByText("turn 1/3").first()).toBeVisible();

    const maxScrollTop = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("*")).reduce(
          (max, el) => Math.max(max, el.scrollTop),
          0
        )
      );

    const before = await maxScrollTop();
    await page.keyboard.press("k");
    await page.waitForTimeout(800);
    const after = await maxScrollTop();
    expect(after).toBeGreaterThan(before);

    await page.screenshot({
      path: "test-results/turn-nav-scroll.png",
      fullPage: false,
    });
  });

  test("re-navigating to a turn lands at the same position every time", async ({
    page,
    network,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await openTranscript(page, network, manyTurns);
    await expect(page.getByText("turn 1/20").first()).toBeVisible();

    // Deep-link jump to a far turn: rows above stay at their estimated height,
    // so this first landing is the "correct" reference (matches a fresh page
    // load). Then bounce away and back to the same turn *in-page* (no reload).
    // A scrollToIndex that depends on measurement state lands the turn's event
    // panel at a different spot the second time — the bug Peter reported: a
    // re-click scrolls further off than the first click / a page reload.
    const encodedFile = encodeURIComponent(LOG_FILE);
    await page.goto(
      `/#/logs/${encodedFile}/samples/sample/1/1/transcript?event=turn-15`
    );
    await expect(page.locator("#turn-15")).toBeVisible();
    await page.waitForTimeout(900);
    const firstArrival = await eventTopInScroller(page, "turn-15");

    await page.keyboard.press("j");
    await page.waitForTimeout(800);
    await page.keyboard.press("k");
    await page.waitForTimeout(800);
    const secondArrival = await eventTopInScroller(page, "turn-15");

    expect(Math.abs(secondArrival - firstArrival)).toBeLessThan(2);
  });

  test("single-event page renders only the target event", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, threeTurns);
    await expect(page.getByText("turn 1/3").first()).toBeVisible();

    const href = await page
      .getByRole("link", { name: "Open turn in new tab" })
      .first()
      .getAttribute("href");
    expect(href).toMatch(/\/event\?event=/);

    await page.goto(href!.replace(/^#/, "/#"));

    await expect(page.getByText("Model Call:").first()).toBeVisible();
    await expect(page.getByText("First turn response").first()).toBeVisible();
    await expect(page.getByText("Third turn response")).toHaveCount(0);

    await page.screenshot({
      path: "test-results/turn-nav-single-event.png",
      fullPage: false,
    });
  });
});
