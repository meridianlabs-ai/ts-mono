/**
 * Modals are native `<dialog>`s opened with showModal(). These cover what
 * only a browser does: focus inside the dialog, an inert page behind it, and
 * Escape and backdrop dismissal that return focus to the opener.
 */
import { testStoreEvent } from "@tsmono/inspect-common/testing";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

const LOG_FILE = "modal.json";

const sample = (id: number) =>
  createEvalSample({
    id,
    messages: [{ role: "user", content: `input ${id}`, source: "input" }],
  });

test("a modal keeps focus inside, makes the page inert, and returns focus when dismissed", async ({
  page,
  network,
}) => {
  serveEvalLog(
    network,
    createEvalLog({ samples: [sample(1), sample(2)] }),
    LOG_FILE
  );
  await page.goto(`/#/logs/${encodeURIComponent(LOG_FILE)}/samples`);

  const opener = page.getByTitle("Edit tags", { exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Edit tags" });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByPlaceholder("Add a tag and press Enter")
  ).toBeFocused();

  const focusOutsideDialog = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      const modal = document.querySelector("dialog");
      return !!active && active !== document.body && !modal?.contains(active);
    });
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await focusOutsideDialog()).toBe(false);
  }
  // A point beside the dialog box hits the dialog's backdrop, not the page.
  expect(
    await page.evaluate(() => {
      const hit = document.elementFromPoint(5, 400);
      return !!hit && !!document.querySelector("dialog")?.contains(hit);
    })
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 400);
  await expect(dialog).toBeHidden();
});

test("Escape closes a popover in a modal first, and only for that keypress", async ({
  page,
  network,
}) => {
  serveEvalLog(
    network,
    createEvalLog({ samples: [sample(1), sample(2)] }),
    LOG_FILE
  );
  await page.goto(`/#/logs/${encodeURIComponent(LOG_FILE)}/samples`);

  const opener = page.getByTitle("Edit tags", { exact: true });
  const dialog = page.getByRole("dialog", { name: "Edit tags" });
  const menu = page.locator("#modal-menu");
  // No modal holds a menu yet, so open a bare auto popover inside one.
  const openMenu = () =>
    page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "modal-menu";
      el.popover = "auto";
      el.textContent = "menu";
      document.querySelector("dialog")?.append(el);
      el.showPopover();
    });

  await opener.click();
  await expect(dialog).toBeVisible();
  await openMenu();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  // With focus on <body>, key events don't pass through the dialog.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  expect(
    await page.evaluate(() => document.activeElement === document.body)
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Safari's sequence, which Chromium doesn't produce: the Escape that
  // closes the menu also sends the dialog a cancel.
  await opener.click();
  await expect(dialog).toBeVisible();
  await openMenu();
  await page.evaluate(() => {
    const modal = document.querySelector("dialog");
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    document.querySelector<HTMLElement>("#modal-menu")?.hidePopover();
    modal?.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a modal doesn't inherit styles from the page that opens it", async ({
  page,
  network,
}) => {
  serveEvalLog(
    network,
    createEvalLog({ samples: [sample(1), sample(2)] }),
    LOG_FILE
  );
  await page.goto(`/#/logs/${encodeURIComponent(LOG_FILE)}/samples`);
  // A modal opened from a clickable card once showed the card's pointer.
  await page.locator("#app").evaluate((app: HTMLElement) => {
    app.style.cursor = "pointer";
  });

  await page.getByTitle("Edit tags", { exact: true }).click();
  const title = page
    .getByRole("dialog", { name: "Edit tags" })
    .getByRole("heading", { name: "Edit tags" });
  await expect(title).toBeVisible();
  expect(await title.evaluate((el) => getComputedStyle(el).cursor)).toBe(
    "auto"
  );
});

// A `script -T` recording: header line, then the bytes the timing file meters.
const session = (stamp: string, text: string) => {
  const header =
    'Script started on 2026-01-01 00:00:00+00:00 [COLUMNS="40" LINES="6"]\n';
  const output = `${header}${text}\r\n`;
  return {
    [`user_${stamp}.input`]: header,
    [`user_${stamp}.output`]: output,
    [`user_${stamp}.timing`]: `O 0.05 ${output.length - header.length}\n`,
  };
};

test("the human-baseline lightbox is modal, takes the arrow keys from the sample navigation, and closes on Escape from the player", async ({
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
          events: [
            testStoreEvent({
              changes: [
                {
                  op: "add",
                  path: "/HumanAgentState:logs",
                  value: {
                    ...session("1700000000_000001", "first"),
                    ...session("1700000000_000002", "second"),
                  },
                  replaced: null,
                },
              ],
            }),
          ],
        }),
        // A second sample, so ArrowRight would otherwise step to it.
        sample(2),
      ],
    }),
    LOG_FILE
  );
  await page.goto(
    `/#/logs/${encodeURIComponent(LOG_FILE)}/samples/sample/1/1/transcript`
  );

  const thumb = page.getByRole("button", { name: /^Terminal Session 1/ });
  await thumb.click();
  const first = page.getByRole("dialog", { name: "Terminal Session 1" });
  await expect(first).toBeVisible();
  await expect(first.getByRole("button", { name: "Close" })).toBeFocused();
  // Past the last control, focus goes to the browser's own UI (<body> here),
  // never to the page.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await first.evaluate((dialog) => {
        const active = document.activeElement;
        return active === document.body || dialog.contains(active);
      })
    ).toBe(true);
  }

  await page.keyboard.press("ArrowRight");
  const second = page.getByRole("dialog", { name: "Terminal Session 2" });
  await expect(second).toBeVisible();
  await expect(page).toHaveURL(/\/sample\/1\/1\//);

  // The player cancels Escape when it has focus.
  await second.locator(".ap-player").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(thumb).toBeFocused();
});
