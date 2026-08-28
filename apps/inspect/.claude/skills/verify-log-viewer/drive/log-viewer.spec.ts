import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

// Real-backend drive: everything here talks to a live `inspect view` server
// through the vite proxy. Never import test/expect from apps/inspect/e2e/
// fixtures — that fixture auto-enables MSW and would silently mock /api.

const evidence = join(import.meta.dirname, "..", "evidence");

// Ground truth from the fixture logs in VERIFY_LOG_DIR (see features/README.md):
// viewer-rich: 5 samples; sample 1/epoch 1 asks "What is 2+2?", answers
// "The answer is 4.", scores includes=C; accuracy metric is 0.8.
const kRichLog =
  "2026-07-07T21-47-35-00-00_viewer-rich_M58v4LGnsyG2Gh3hwXxpeP.eval";
const richSampleUrl = (tab: string) =>
  `/#/logs/${encodeURIComponent(kRichLog)}/samples/sample/1/1/${tab}`;

const shot = (page: import("@playwright/test").Page, name: string) =>
  page.screenshot({ path: join(evidence, name) });

test.beforeAll(() => {
  mkdirSync(evidence, { recursive: true });
});

test("log list (Tasks view) shows fixture logs and opens one", async ({
  page,
}) => {
  await page.goto("/");
  const grid = page.getByRole("grid", { name: "Evaluation logs" });
  await expect(grid).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("gridcell").filter({ hasText: "viewer_arithmetic" }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("gridcell").filter({ hasText: "viewer_rich" }).first()
  ).toBeVisible();
  await shot(page, "log-list-tasks-view.png");

  await page
    .getByRole("gridcell")
    .filter({ hasText: "viewer_rich" })
    .first()
    .click();
  await page.waitForURL(/#\/tasks\//);
  await expect(page.getByRole("tab", { name: /^Samples?$/ })).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, "log-list-opened-log.png");
});

test("sample list of an opened log shows its samples and opens detail", async ({
  page,
}) => {
  await page.goto(`/#/logs/${encodeURIComponent(kRichLog)}`);
  const samples = page.getByRole("grid", { name: "Samples" });
  await expect(samples).toBeVisible({ timeout: 15_000 });
  const firstSample = samples
    .getByRole("gridcell")
    .filter({ hasText: "What is 2+2?" })
    .first();
  await expect(firstSample).toBeVisible();
  await shot(page, "sample-list.png");

  await firstSample.click();
  await page.waitForURL(/\/samples\/sample\//);
  await expect(page.locator("[id^='sample-heading-']")).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, "sample-detail-opened.png");
});

test("sample messages tab renders the conversation", async ({ page }) => {
  await page.goto(richSampleUrl("messages"));
  const panel = page.locator("#messages-contents");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText("What is 2+2?").first()).toBeVisible();
  await expect(panel.getByText("The answer is 4.").first()).toBeVisible();
  await shot(page, "sample-messages.png");
});

test("sample transcript tab renders the event timeline", async ({ page }) => {
  await page.goto(richSampleUrl("transcript"));
  const panel = page.locator("#transcript-contents");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  // The fixture sample's events include a model event and a score event.
  await expect(panel.getByText(/model call/i).first()).toBeVisible();
  await expect(panel.getByText("The answer is 4.").first()).toBeVisible();
  await expect(page.locator(".transcript-outline")).toBeVisible();
  await shot(page, "sample-transcript.png");
});

test("scores render in the log list and the sample scoring tab", async ({
  page,
}) => {
  await page.goto("/");
  const grid = page.getByRole("grid", { name: "Evaluation logs" });
  await expect(grid).toBeVisible({ timeout: 15_000 });
  const richRow = grid
    .getByRole("row")
    .filter({ hasText: "viewer_rich" })
    .first();
  await expect(richRow.locator('[data-col-id="score"]')).toContainText("0.8");
  await shot(page, "scores-log-list.png");

  await page.goto(richSampleUrl("scoring"));
  const scoring = page.locator("#scoring-contents");
  await expect(scoring).toBeVisible({ timeout: 15_000 });
  await expect(scoring.getByText("includes").first()).toBeVisible();
  await expect(scoring.getByText("C", { exact: true }).first()).toBeVisible();
  await shot(page, "scores-sample-scoring-tab.png");
});
