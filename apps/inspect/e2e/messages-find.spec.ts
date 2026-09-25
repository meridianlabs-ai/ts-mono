/**
 * Find band on a sample's Messages tab, where matches are stepped with
 * `window.find`. Firefox blurs the input on window.find; refocusing it left
 * a collapsed selection at the input, so every search restarted from the top
 * and the match was never painted.
 */
import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";

import type { ChatMessage } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

const LOG_FILE = "test-messages-find.json";

const MESSAGES: ChatMessage[] = [
  { role: "user", content: "first kumquat here", source: "input" },
  { role: "assistant", content: "no fruit in this one", source: "generate" },
  { role: "user", content: "second kumquat here", source: "input" },
  { role: "assistant", content: "still nothing", source: "generate" },
  {
    role: "user",
    content: "third [kumquat here](https://example.com/facts)",
    source: "input",
  },
];

const findInput = (page: Page) => page.getByPlaceholder("Find");
const matchStatus = (page: Page) => page.getByTestId("find-band-match-count");

test.beforeEach(async ({ page, network }) => {
  const evalLog = createEvalLog({
    samples: [createEvalSample({ id: 1, epoch: 1, messages: MESSAGES })],
  });
  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: "find-test", task_id: "find-test" }],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", () => HttpResponse.json(evalLog))
  );
  await page.goto(
    `/#/logs/${encodeURIComponent(LOG_FILE)}/samples/sample/1/1/messages`
  );
  await expect(
    page.locator("#messages-contents").getByText("third kumquat here")
  ).toBeVisible();

  await page.keyboard.press("ControlOrMeta+f");
  await expect(findInput(page)).toBeFocused();
  await findInput(page).fill("kumquat");
  await expect(matchStatus(page)).toHaveText("1 of 3");
});

test("Enter and Shift+Enter step through matches", async ({ page }) => {
  await page.keyboard.press("Enter");
  await expect(matchStatus(page)).toHaveText("2 of 3");
  await page.keyboard.press("Enter");
  await expect(matchStatus(page)).toHaveText("3 of 3");
  await page.keyboard.press("Shift+Enter");
  await expect(matchStatus(page)).toHaveText("2 of 3");
  await page.keyboard.press("Enter");
  await expect(matchStatus(page)).toHaveText("3 of 3");
  // The third match is inside a link; Enter must step on, not follow it.
  await page.keyboard.press("Enter");
  await expect(matchStatus(page)).toHaveText("1 of 3");
  expect(page.url()).toContain("/messages");
});

test("Enter selects the match; typing still edits", async ({ page }) => {
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.getSelection();
        return {
          collapsed: selection?.isCollapsed ?? true,
          text: selection?.rangeCount ? selection.getRangeAt(0).toString() : "",
        };
      })
    )
    .toEqual({ collapsed: false, text: "kumquat" });
  await expect(matchStatus(page)).toHaveText("2 of 3");

  await page.keyboard.press("Backspace");
  await expect(findInput(page)).toHaveValue("kumqua");
  await expect(matchStatus(page)).toHaveText("1 of 3");
});
