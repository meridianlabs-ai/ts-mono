import { http, HttpResponse } from "msw";

import {
  installWebviewHost,
  withWebviewBootstrap,
} from "@tsmono/react/testing";

import { expect, test } from "./fixtures/app";
import { pathParam } from "./fixtures/handlers";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

test("webview recreation restores sample identity and accepts a different host command", async ({
  page,
  network,
}) => {
  const launch = {
    type: "updateState",
    url: "file:///logs/multi.json",
    sample_id: "same-id",
    sample_epoch: "1",
  };
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
    samples: [sample(1, "First epoch"), sample(2, "Restored second epoch")],
  });
  const single = createEvalLog({ samples: [sample(1, "Other log content")] });
  network.use(
    http.get("*/api/logs/:file", ({ params }) =>
      HttpResponse.json(
        pathParam(params.file).endsWith("single.json") ? single : multi
      )
    )
  );
  await page.addInitScript(installWebviewHost);
  await page.route("http://localhost:5175/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: withWebviewBootstrap(await response.text(), {
        "inspect-host-capabilities": ["http_request"],
        "logview-state": launch,
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  await expect(page.getByText("First epoch", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next sample", exact: true }).click();
  await expect(
    page.getByText("Restored second epoch", { exact: true })
  ).toBeVisible();

  // VS Code recreates the document without its hash, retaining only getState().
  await page.goto("/");
  await expect(page).toHaveURL(/same-id\/2\/messages/);
  await expect(
    page.getByText("Restored second epoch", { exact: true })
  ).toBeVisible();
  await page.evaluate((data) => window.postMessage(data, "*"), launch);
  await expect(page).toHaveURL(/same-id\/2\/messages/);

  await page.evaluate(() => {
    window.postMessage(
      { type: "updateState", url: "file:///logs/single.json" },
      "*"
    );
  });
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  await expect(
    page.getByText("Other log content", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Restored second epoch", { exact: true })
  ).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByText("Other log content", { exact: true })
  ).toBeVisible();

  // An explicit deep link takes priority over this panel's saved route.
  await page.goto("/#/logs/multi.json/samples/sample/same-id/1/messages");
  await expect(page.getByText("First epoch", { exact: true })).toBeVisible();
});
