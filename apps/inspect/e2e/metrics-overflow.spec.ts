import type { NetworkFixture } from "@msw/playwright";
import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";

import type { EvalScore } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
} from "./fixtures/test-data";

const LOG_FILE = "many-metrics.json";
const metricNames = Array.from(
  { length: 13 },
  (_, index) => `metric_${index + 1}`
);

const makeScore = (index: number): EvalScore => ({
  name: `scorer_${index}`,
  scorer: `scorer_${index}`,
  scored_samples: 2,
  unscored_samples: 0,
  params: {},
  metrics: Object.fromEntries(
    metricNames.map((name, metricIndex) => [
      name,
      { name, value: (metricIndex + 1) / 10, params: {} },
    ])
  ),
});

const openLogWithScores = async (
  page: Page,
  network: NetworkFixture,
  scores: EvalScore[]
) => {
  const sample = createEvalSample({
    id: 1,
    messages: [
      { role: "user", content: "Input", source: "input" },
      { role: "assistant", content: "Response", source: "generate" },
    ],
  });
  const evalLog = {
    ...createEvalLog({
      samples: [sample],
      eval: { task: "many-metrics" },
    }),
    results: {
      total_samples: 2,
      completed_samples: 2,
      scores,
    },
  };
  const details = createLogDetails(evalLog);

  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: "many-metrics", task_id: "metrics" }],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", () => HttpResponse.json(evalLog)),
    http.get("*/api/log-details/:file", () => HttpResponse.json(details)),
    http.get("*/api/log-info/:file", () => HttpResponse.json({ size: 0 })),
    http.get("*/api/log-headers*", () =>
      HttpResponse.json([
        {
          eval_id: details.eval.eval_id,
          run_id: details.eval.run_id,
          task: details.eval.task,
          task_id: details.eval.task_id,
          task_version: details.eval.task_version,
          model: details.eval.model,
          status: details.status,
          started_at: details.stats?.started_at,
          completed_at: details.stats?.completed_at,
        },
      ])
    )
  );

  await page.goto(`/#/logs/${encodeURIComponent(LOG_FILE)}`);
};

test("many metrics stay bounded in the title and scroll in the dialog", async ({
  page,
  network,
}) => {
  await openLogWithScores(page, network, [
    ...Array.from({ length: 5 }, (_, index) => makeScore(index + 1)),
  ]);

  const moreButton = page.getByRole("button", { name: "All scoring..." });
  await expect(moreButton).toBeVisible();
  const summary = moreButton.locator("..");
  await expect(
    summary.getByRole("columnheader", { name: "metric_5" })
  ).toBeVisible();
  await expect(
    summary.getByRole("columnheader", { name: "metric_6" })
  ).toHaveCount(0);

  const summaryBounds = await summary.boundingBox();
  expect(summaryBounds).not.toBeNull();
  expect(summaryBounds!.x + summaryBounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width
  );

  await moreButton.click();
  const dialog = page.getByRole("dialog", { name: "Scoring Detail" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("columnheader", { name: "metric_13" })
  ).toBeAttached();

  const scroller = dialog.getByTestId("score-grid");
  const scrollState = await scroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    overflowX: getComputedStyle(element).overflowX,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollState.overflowX).toBe("auto");
  expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);
});

// Mirrors a report where two scorers sharing a long prefix, each emitting a
// dict-valued metric group, were indistinguishable in both the title card
// and the dialog.
const groupedScore = (name: string, values: [number, number]): EvalScore => ({
  name,
  scorer: name,
  scored_samples: 2,
  unscored_samples: 0,
  params: {},
  metrics: {
    grouped_Cbase_O: {
      name: "Cbase_O",
      group: "grouped",
      value: values[0],
      params: {},
    },
    grouped_T2_O: {
      name: "T2_O",
      group: "grouped",
      value: values[1],
      params: {},
    },
  },
});

const longNames = [
  "cryptanalysis_bench_scorer_with_full_context",
  "cryptanalysis_bench_scorer_with_partial_context",
];

const isEllipsized = (element: HTMLElement) =>
  element.scrollWidth > element.clientWidth;

// rows are a fixed 32px; a cell taller than this has wrapped
const kWrappedHeight = 40;

test("long scorer names read in full in the dialog and on hover in the title", async ({
  page,
  network,
}) => {
  await openLogWithScores(page, network, [
    groupedScore(longNames[0]!, [0, 0.193]),
    groupedScore(longNames[1]!, [0, 0.034]),
    // a second metric signature forms a second group, which seats the
    // "All scoring..." link that opens the dialog
    makeScore(1),
  ]);

  const moreButton = page.getByRole("button", { name: "All scoring..." });
  await expect(moreButton).toBeVisible();
  const summary = moreButton.locator("..");
  for (const name of longNames) {
    await expect(summary.getByRole("cell", { name })).toHaveAttribute(
      "title",
      name
    );
  }

  await moreButton.click();
  const dialog = page.getByRole("dialog", { name: "Scoring Detail" });
  await expect(dialog).toBeVisible();
  for (const name of longNames) {
    const cell = dialog.getByRole("cell", { name });
    await expect(cell).toBeVisible();
    expect(await cell.evaluate(isEllipsized)).toBe(false);
    // the dialog has room to grow, so the name shouldn't need to wrap
    expect((await cell.boundingBox())!.height).toBeLessThan(kWrappedHeight);
  }
  await expect(
    dialog.getByRole("columnheader", { name: "Cbase_O" })
  ).toBeVisible();
});

test("a scorer name too long for the dialog wraps instead of truncating", async ({
  page,
  network,
}) => {
  const hugeName = Array.from(
    { length: 12 },
    (_, i) => `very_long_scorer_segment_${i}`
  ).join("_");
  await openLogWithScores(page, network, [
    groupedScore(hugeName, [0.5, 0.25]),
    makeScore(1),
  ]);

  await page.getByRole("button", { name: "All scoring..." }).click();
  const dialog = page.getByRole("dialog", { name: "Scoring Detail" });
  const cell = dialog.getByRole("cell", { name: hugeName });
  await expect(cell).toBeVisible();
  expect(await cell.evaluate(isEllipsized)).toBe(false);

  const dialogBounds = await dialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect((await cell.boundingBox())!.height).toBeGreaterThan(kWrappedHeight);
  await expect(
    dialog.getByRole("columnheader", { name: "T2_O" })
  ).toBeInViewport();
});
