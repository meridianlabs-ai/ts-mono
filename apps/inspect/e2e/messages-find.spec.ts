/**
 * Find on a sample's Messages tab. Matches are painted with the CSS Custom
 * Highlight API; stepping reaches rows the virtual list hasn't rendered and
 * never moves the document selection or the band's focus.
 */
import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";

import type { ChatMessage } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

const LOG_FILE = "test-messages-find.json";
const FILLER = "Nothing to see in this message. ".repeat(40);

// 60 tall messages with "kumquat" in messages 5, 15, ... 55, so the later
// matches start out of the rendered rows. Message 0, the sample's input, also
// shows in the sample header; it has no match.
const MESSAGES = Array.from({ length: 60 }, (_, i): ChatMessage => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: i % 10 === 5 ? `message ${i} has a kumquat. ${FILLER}` : FILLER,
  source: i % 2 === 0 ? "input" : "generate",
}));

const findInput = (page: Page) => page.getByPlaceholder("Find");
const matchStatus = (page: Page) => page.getByTestId("find-band-match-count");

// The current highlight's text, the message row holding it, and whether it
// sits inside the scrolled list's viewport.
const currentMatch = (page: Page) =>
  page.evaluate(() => {
    const highlight = CSS.highlights.get("find-current");
    const range = highlight ? [...highlight][0] : undefined;
    if (!(range instanceof Range)) return null;
    const row = range.startContainer.parentElement?.closest("[data-index]");
    const scroller = document.getElementById("messages-contents");
    const rect = range.getBoundingClientRect();
    const view = scroller?.getBoundingClientRect();
    return {
      text: range.toString(),
      row: row?.getAttribute("data-index"),
      inView:
        view !== undefined &&
        rect.top >= view.top &&
        rect.bottom <= view.bottom,
    };
  });

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
  const messages = page.locator("#messages-contents");
  await expect(messages.getByText("message 5 has a kumquat")).toBeVisible();
  await expect(messages.getByText("message 55 has a kumquat")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+f");
  await expect(findInput(page)).toBeFocused();
  await findInput(page).fill("kumquat");
  await expect(matchStatus(page)).toHaveText("1 of 6");
});

test("steps into unrendered rows and wraps at both ends", async ({ page }) => {
  await expect.poll(() => currentMatch(page)).toMatchObject({ row: "5" });

  await page.keyboard.press("Shift+Enter");
  await expect(matchStatus(page)).toHaveText("6 of 6");
  await expect
    .poll(() => currentMatch(page))
    .toEqual({ text: "kumquat", row: "55", inView: true });

  await page.keyboard.press("Shift+Enter");
  await expect(matchStatus(page)).toHaveText("5 of 6");
  await expect
    .poll(() => currentMatch(page))
    .toEqual({ text: "kumquat", row: "45", inView: true });

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(matchStatus(page)).toHaveText("1 of 6");
  await expect
    .poll(() => currentMatch(page))
    .toEqual({ text: "kumquat", row: "5", inView: true });
});

test("leaves the selection and focus alone, and clears on Escape", async ({
  page,
}) => {
  await page.keyboard.press("Enter");
  await expect(matchStatus(page)).toHaveText("2 of 6");
  await expect(findInput(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("");

  await page.keyboard.press("Escape");
  await expect(findInput(page)).toHaveCount(0);
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
});
