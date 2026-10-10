import { readFile } from "node:fs/promises";

import { http, HttpResponse } from "msw";

import type { ChatMessage } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
} from "./fixtures/test-data";

const LOG_FILE = "test-message-selection.json";

async function openSample(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  messages: ChatMessage[],
  options?: { sampleId?: number | string; epoch?: number }
) {
  const sampleId = options?.sampleId ?? 1;
  const epoch = options?.epoch ?? 1;

  const sample = createEvalSample({ id: sampleId, epoch, messages });
  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    // get_log_root — the dir-mode gate blocks on this.
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: "chat-test", task_id: "chat-test" }],
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
  await page.goto(
    `/#/logs/${encodedFile}/samples/sample/${sampleId}/${epoch}/messages`
  );
}

test("legacy message selection exports original objects with folded tool results", async ({
  page,
  network,
}, testInfo) => {
  const messages: ChatMessage[] = [
    { role: "user", content: "Run the command" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          function: "submit",
          arguments: { answer: "command result" },
          type: "function",
        },
      ],
    },
    { role: "tool", content: "command result", tool_call_id: "call-1" },
    { role: "assistant", content: "Done" },
  ];
  await openSample(page, network, messages);
  const area = page.locator("#messages-contents");
  await expect(
    area.getByText("Run the command", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: /Select$/ }).click();
  const boxes = area.getByRole("checkbox");
  await expect(boxes).toHaveCount(3);
  await boxes.nth(0).click();
  await boxes.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByRole("button", { name: /Select · 2$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Print · 2$/ })).toBeVisible();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const download = await downloaded;
  const path = testInfo.outputPath("selected-messages.json");
  await download.saveAs(path);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(
    messages.slice(0, 3)
  );
  await page
    .getByRole("button", { name: "Clear selection and exit", exact: true })
    .click();
  await expect(boxes).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Select$/ })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});
