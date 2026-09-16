import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";
import { pathParam } from "./fixtures/handlers";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

test("route identity survives cross-log navigation, Back, and reload without a store selection", async ({
  page,
  network,
}) => {
  const sample = (epoch: number, content: string) =>
    createEvalSample({
      id: "same-id",
      epoch,
      messages: [
        { role: "user", content: "Prompt" },
        { role: "assistant", content },
      ],
    });
  const multi = createEvalLog({
    eval: { task: "multi", task_id: "multi" },
    samples: [
      sample(1, "First epoch response"),
      sample(2, "Second epoch response"),
    ],
  });
  const single = createEvalLog({
    eval: { task: "single", task_id: "single" },
    samples: [sample(1, "Different log response")],
  });
  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [
          { name: "multi.json", task: "multi", task_id: "multi" },
          { name: "single.json", task: "single", task_id: "single" },
        ],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", ({ params }) =>
      HttpResponse.json(
        pathParam(params.file).endsWith("single.json") ? single : multi
      )
    )
  );
  await page.goto("/#/logs/multi.json/samples/sample/same-id/1/messages");
  await expect(
    page.getByText("First epoch response", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Next sample", exact: true }).click();
  await expect(page).toHaveURL(/same-id\/2\/messages/);
  await expect(
    page.getByText("Second epoch response", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("First epoch response", { exact: true })
  ).toHaveCount(0);

  await page.evaluate(() => {
    window.location.hash = "/tasks/single.json/samples/messages";
  });
  await expect(
    page.getByText("Different log response", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Second epoch response", { exact: true })
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("Different log response", { exact: true })
  ).toBeVisible();

  await page.goBack();
  await expect(
    page.getByText("Second epoch response", { exact: true })
  ).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "/logs/multi.json/samples";
  });
  await expect(
    page.getByRole("grid", { name: "Samples", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Messages$/i })).toHaveCount(0);
  const grid = page.getByRole("grid", { name: "Samples", exact: true });
  await expect(grid.getByRole("row", { selected: true })).toHaveCount(1);
  await grid.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/same-id\/2/);
  await expect(
    page.getByText("Second epoch response", { exact: true })
  ).toBeVisible();
});
