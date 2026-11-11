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

const serveSample = (network: Parameters<typeof serveEvalLog>[0]) =>
  serveEvalLog(
    network,
    createEvalLog({
      samples: [
        createEvalSample({
          id: 1,
          messages: [
            { role: "user", content: "What is 2+2?", source: "input" },
            {
              role: "assistant",
              content: "The answer is 4.",
              source: "generate",
            },
          ],
        }),
      ],
    }),
    LOG_FILE
  );

/** Opens the sample's Copy menu; returns its trigger and last item. */
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
  await page.goto("/");
  const funnel = page.getByRole("button", { name: "Filter task", exact: true });
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
