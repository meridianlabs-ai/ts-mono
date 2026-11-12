/**
 * Floating panels (filters, menus) render in the browser's top layer with
 * CSS anchor positioning. These cover what only a real browser does: focus
 * on open, Escape and focus return, sizing and flipping.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

const LOG_FILE = "popovers.json";

const sample = (id: number, question: string, answer: string) =>
  createEvalSample({
    id,
    messages: [
      { role: "user", content: question, source: "input" },
      { role: "assistant", content: answer, source: "generate" },
    ],
  });

// Two samples, so the log opens on its samples grid rather than skipping
// straight to its only sample.
const serveSample = (network: Parameters<typeof serveEvalLog>[0]) =>
  serveEvalLog(
    network,
    createEvalLog({
      samples: [
        sample(1, "What is 2+2?", "The answer is 4."),
        sample(2, "What is 3+3?", "The answer is 6."),
      ],
    }),
    LOG_FILE
  );

async function openCopyMenu(page: Page): Promise<{
  trigger: Locator;
  lastItem: Locator;
}> {
  await page.goto(
    `/#/logs/${encodeURIComponent(LOG_FILE)}/samples/sample/1/1/messages`
  );
  const trigger = page.getByRole("button", { name: "Copy", exact: true });
  await trigger.click();
  return {
    trigger,
    lastItem: page.getByRole("button", { name: "Transcript", exact: true }),
  };
}

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
};

test("a column filter opens with its input focused, and Escape returns focus to the funnel", async ({
  page,
  network,
}) => {
  serveSample(network);
  await page.goto(`/#/logs/${encodeURIComponent(LOG_FILE)}/samples`);
  const funnel = page.getByRole("button", {
    name: "Filter input",
    exact: true,
  });
  await funnel.click();

  const input = page.getByPlaceholder("Filter");
  await expect(input).toBeFocused();
  expect((await box(input)).y).toBeGreaterThan((await box(funnel)).y);

  await page.keyboard.press("Escape");
  await expect(input).toBeHidden();
  await expect(funnel).toBeFocused();
});

test("a toolbar menu is tall enough to show every item, and an outside click closes it", async ({
  page,
  network,
}) => {
  serveSample(network);
  const { lastItem: last } = await openCopyMenu(page);
  await expect(last).toBeVisible();
  // The menu clips its overflow, so an item cut off by a too-short menu is
  // still "visible" to Playwright: compare it to the element at its center.
  const b = await box(last);
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.textContent,
    { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  );
  expect(hit).toBe("Transcript");

  await page.mouse.click(10, 500);
  await expect(last).toBeHidden();
});

test("a menu with no room below its trigger opens above it", async ({
  page,
  network,
}) => {
  serveSample(network);
  await page.setViewportSize({ width: 1280, height: 190 });
  const { trigger, lastItem: last } = await openCopyMenu(page);
  await expect(last).toBeVisible();
  const lastBox = await box(last);
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(
    (await box(trigger)).y
  );
});

// Two agents' recordings, so fullscreen terminals show the agent menu.
const cast = (agent: string, start: number) =>
  [
    JSON.stringify({
      version: 2,
      width: 80,
      height: 24,
      timestamp: 1_792_950_894 + start,
      ir_agent_span_id: `span-${agent}`,
      ir_agent: agent,
    }),
    JSON.stringify([0, "o", `$ echo ${agent}\r\n`]),
    JSON.stringify([5, "o", `${agent}\r\n`]),
  ].join("\n");

test("Escape in fullscreen terminals closes the agent menu before leaving fullscreen", async ({
  page,
  network,
}) => {
  serveEvalLog(
    network,
    createEvalLog({
      samples: [
        createEvalSample({
          id: 1,
          messages: [{ role: "user", content: "Run it", source: "input" }],
          store: {
            "asciinema:terminal-main": cast("main", 0),
            "asciinema:terminal-helper": cast("helper", 2),
          },
        }),
      ],
    }),
    LOG_FILE
  );
  await page.goto(
    `/#/logs/${encodeURIComponent(LOG_FILE)}/samples/sample/1/1/terminals`
  );
  await page.getByRole("button", { name: "Show terminals fullscreen" }).click();
  const fullscreen = page.getByRole("region", { name: "Terminals fullscreen" });
  await expect(fullscreen).toBeVisible();

  const picker = fullscreen.getByTitle("Show another agent's terminals");
  await picker.click();
  const menu = page.getByText("Agents in this sample");
  await expect(menu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(picker).toBeFocused();
  await expect(fullscreen).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(fullscreen).toBeHidden();
});
