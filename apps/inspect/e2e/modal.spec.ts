/**
 * Modals are native `<dialog>`s opened with showModal(). These cover what
 * only a browser does: focus inside the dialog, an inert page behind it, and
 * Escape and backdrop dismissal that return focus to the opener.
 */
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
