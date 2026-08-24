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

test("many metrics stay bounded in the title and scroll in the dialog", async ({
  page,
  network,
}) => {
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
      scores: Array.from({ length: 5 }, (_, index) => makeScore(index + 1)),
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

  const scroller = dialog.locator("table").first().locator("../..");
  const scrollState = await scroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    overflowX: getComputedStyle(element).overflowX,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollState.overflowX).toBe("auto");
  expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);
});
