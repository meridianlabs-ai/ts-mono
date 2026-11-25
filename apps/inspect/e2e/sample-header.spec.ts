import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

test("an errored sample's header shows its error type and run time", async ({
  page,
  network,
}) => {
  const sample = {
    ...createEvalSample({
      id: 1,
      messages: [{ role: "user", content: "input 1", source: "input" }],
    }),
    error: {
      message: "RuntimeError('boom')",
      traceback: "Traceback (most recent call last):\nRuntimeError: boom",
      traceback_ansi: "RuntimeError: boom",
    },
    total_time: 12.5,
  };
  serveEvalLog(network, createEvalLog({ samples: [sample] }), "errored.json");

  await page.goto("/#/logs/errored.json/samples/sample/1/1");

  const header = page.locator("[id^='sample-heading-']");
  await expect(header.getByText("Epoch 1", { exact: true })).toBeVisible();
  await expect(header.getByText("RuntimeError", { exact: true })).toBeVisible();
  await expect(header.getByText("12.5 sec", { exact: true })).toBeVisible();
});
