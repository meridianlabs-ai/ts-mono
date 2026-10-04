/**
 * Regression test: an expanded ExpandablePanel that is taller than the
 * viewport must keep its "less…" toggle on screen while the user scrolls
 * through it.
 *
 * The toggle is `position: sticky` and tracks the nearest scroll container.
 * A wrapper between the panel and the transcript scroller that sets
 * `overflow: hidden`/`auto` becomes that container and pins the toggle to
 * the panel's bottom edge — off screen for any tall panel. The tool-block
 * grammar (#326) introduced such wrappers around tool-call panels.
 */
import { http, HttpResponse } from "msw";

import type {
  ChatMessage,
  EvalSample,
  ModelEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
  createModelOutput,
} from "./fixtures/test-data";

const LOG_FILE = "test-sticky-toggle.json";

type Events = EvalSample["events"];

const lines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix} line ${i}`).join("\n");

const LONG_OUTPUT = lines("output", 400);
const LONG_INPUT = lines("input", 400);
const LONG_PROSE = lines("prose", 400);

function createToolEvent(): ToolEvent {
  return {
    event: "tool",
    uuid: "tool-evt-1",
    function: "bash",
    arguments: { cmd: LONG_INPUT },
    type: "function",
    id: "tool-call-1",
    result: LONG_OUTPUT,
    events: [],
    timestamp: "2025-01-15T10:00:05Z",
    working_start: 5,
    working_time: 2,
  };
}

function createModelEvent(): ModelEvent {
  return {
    event: "model",
    uuid: "model-evt-1",
    model: "claude-sonnet-4-5-20250929",
    input: [],
    output: createModelOutput(LONG_PROSE),
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: "2025-01-15T10:00:00Z",
    working_start: 0,
    working_time: 3,
  };
}

async function openTranscript(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  events: Events
) {
  const messages: ChatMessage[] = [
    { role: "user", content: "Hello", source: "input" },
    { role: "assistant", content: "Hi there", source: "generate" },
  ];
  const sample = createEvalSample({ id: 1, epoch: 1, messages, events });
  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: "sticky-test", task_id: "sticky" }],
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

type Page = Parameters<Parameters<typeof test>[2]>[0]["page"];

/** The ExpandablePanel whose content contains `marker`. */
function panelWithText(page: Page, marker: string) {
  return page
    .locator('[data-expandable-panel="true"]', { hasText: marker })
    .first();
}

/**
 * Expand the panel, scroll its top edge to the top of the viewport, and
 * return the geometry the assertions need. The panel must end up taller
 * than the viewport, otherwise the sticky range is empty and the test
 * proves nothing.
 */
async function expandAndScrollThrough(page: Page, marker: string) {
  const panel = panelWithText(page, marker);
  await expect(panel).toBeVisible();
  const more = panel.getByRole("button", { name: "more..." });
  await expect(more).toBeVisible();
  await more.click();
  const less = panel.getByRole("button", { name: "less..." });
  await expect(less).toBeVisible();

  await panel.evaluate((el) => el.scrollIntoView({ block: "start" }));

  const viewportHeight = page.viewportSize()?.height ?? 0;
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  // Precondition: the expanded panel overflows the viewport.
  expect(panelBox!.y + panelBox!.height).toBeGreaterThan(viewportHeight);

  return { panel, less, viewportHeight };
}

/** Polls: collapsing a tall panel smooth-scrolls its bottom edge into view,
 * so the settled geometry arrives a few frames after the click. */
async function expectOnScreen(
  toggle: ReturnType<Page["getByRole"]>,
  viewportHeight: number
) {
  await expect(async () => {
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
  }).toPass({ timeout: 5_000 });
}

test.describe("ExpandablePanel sticky toggle", () => {
  test("tool output taller than the viewport keeps 'less…' on screen", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, [createToolEvent()]);
    const { less, viewportHeight } = await expandAndScrollThrough(
      page,
      "output line 399"
    );
    await expectOnScreen(less, viewportHeight);

    // Still pinned after scrolling further into the panel.
    await page.mouse.wheel(0, viewportHeight);
    await expectOnScreen(less, viewportHeight);
  });

  test("tool input taller than the viewport keeps 'less…' on screen", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, [createToolEvent()]);
    const { less, viewportHeight } = await expandAndScrollThrough(
      page,
      "input line 399"
    );
    await expectOnScreen(less, viewportHeight);
  });

  // Control: the assistant prose panel has no overflow wrapper between it
  // and the scroller, so this passes before and after the fix and proves the
  // geometry check itself detects a working sticky toggle.
  test("model output taller than the viewport keeps 'less…' on screen", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, [createModelEvent()]);
    const { less, viewportHeight } = await expandAndScrollThrough(
      page,
      "prose line 399"
    );
    await expectOnScreen(less, viewportHeight);
  });

  test("collapsing a tall panel keeps the toggle usable", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, [createToolEvent()]);
    const { panel, less, viewportHeight } = await expandAndScrollThrough(
      page,
      "output line 399"
    );
    await less.click();
    const more = panel.getByRole("button", { name: "more..." });
    await expect(more).toBeVisible();
    await expectOnScreen(more, viewportHeight);
  });
});
