/**
 * Sample metadata tab e2e tests.
 *
 * The metadata tab renders a virtualized RecordTree embedded in the shared
 * sample scroller (content sits above the list in the same scroll
 * container). These tests cover row rendering, virtualization windowing,
 * collapse/expand, and tab flips.
 */

import { http, HttpResponse } from "msw";

import type { EvalSample } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
} from "./fixtures/test-data";

const LOG_FILE = "test-metadata-tree.json";

function buildMetadata(): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    summary: "top-level string value",
    nested: {
      alpha: 1,
      beta: "two",
      gamma: { deep: true },
    },
  };
  for (let i = 0; i < 300; i++) {
    metadata[`key_${String(i).padStart(3, "0")}`] = `value ${i}`;
  }
  return metadata;
}

async function openMetadataTab(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"]
) {
  const sample = createEvalSample({
    id: 1,
    epoch: 1,
    messages: [
      { role: "user", content: "Hello", source: "input" },
      { role: "assistant", content: "Hi there", source: "generate" },
    ],
  });
  (sample as { metadata: EvalSample["metadata"] }).metadata = buildMetadata();

  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [
          { name: LOG_FILE, task: "metadata-test", task_id: "metadata-test" },
        ],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", () => HttpResponse.json(evalLog)),
    http.get("*/api/log-headers*", () =>
      HttpResponse.json([
        {
          eval_id: logDetails.eval.eval_id,
          run_id: logDetails.eval.run_id,
          model: logDetails.eval.model,
          status: logDetails.status,
          started_at: logDetails.stats?.started_at,
          completed_at: logDetails.stats?.completed_at,
        },
      ])
    )
  );

  const encodedFile = encodeURIComponent(LOG_FILE);
  await page.goto(
    `/#/logs/${encodedFile}/samples/sample/1/1/metadata`
  );
}

test("metadata tab renders a virtualized record tree", async ({
  page,
  network,
}) => {
  await openMetadataTab(page, network);

  const tree = page.locator('[id^="task-sample-metadata-"]');
  await expect(tree).toBeVisible();
  await expect(tree.getByText("summary:", { exact: true })).toBeVisible();
  await expect(tree.getByText("top-level string value")).toBeVisible();

  // Virtualization: with 300+ rows, only a window is mounted.
  const rowCount = await tree.locator("[data-item-index]").count();
  expect(rowCount).toBeGreaterThan(5);
  expect(rowCount).toBeLessThan(150);
});

test("scrolling reaches rows beyond the initial window", async ({
  page,
  network,
}) => {
  await openMetadataTab(page, network);

  const tree = page.locator('[id^="task-sample-metadata-"]');
  await expect(tree.getByText("key_000:", { exact: true })).toBeVisible();

  // The tail row isn't mounted until the shared container scrolls down.
  await expect(tree.getByText("key_299:", { exact: true })).toHaveCount(0);

  // Scroll the nearest scrollable ancestor (the shared sample scroller) to
  // the bottom, repeating as row measurements refine the total height.
  await expect(async () => {
    await tree.evaluate((el) => {
      let node = el.parentElement;
      while (node && node.scrollHeight <= node.clientHeight) {
        node = node.parentElement;
      }
      if (node) node.scrollTop = node.scrollHeight;
    });
    await expect(tree.getByText("key_299:", { exact: true })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 15000 });
});

test("nodes collapse and expand", async ({ page, network }) => {
  await openMetadataTab(page, network);

  const tree = page.locator('[id^="task-sample-metadata-"]');
  // `nested` renders expanded (defaultExpandLevel 1) with its children.
  await expect(tree.getByText("alpha:", { exact: true })).toBeVisible();

  await tree.getByText("nested:", { exact: true }).click();
  await expect(tree.getByText("alpha:", { exact: true })).toHaveCount(0);
  await expect(tree.getByText("Object(3)")).toBeVisible();

  await tree.getByText("nested:", { exact: true }).click();
  await expect(tree.getByText("alpha:", { exact: true })).toBeVisible();
});

test("tab flips keep the tree usable", async ({ page, network }) => {
  await openMetadataTab(page, network);

  const tree = page.locator('[id^="task-sample-metadata-"]');
  await expect(tree.getByText("summary:", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Messages" }).click();
  await expect(page.getByText("Hi there")).toBeVisible();

  await page.getByRole("tab", { name: "Metadata" }).click();
  await expect(tree.getByText("summary:", { exact: true })).toBeVisible();
  await expect(tree.getByText("key_000:", { exact: true })).toBeVisible();
});
