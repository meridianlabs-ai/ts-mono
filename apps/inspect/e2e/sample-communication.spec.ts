/**
 * Sample Communication tab e2e tests: the tab's visibility and routing on a
 * real swarm log, read through the zip with its attachments resolved, and
 * which find band Ctrl/Cmd+F opens. The rows, the send/delivery join,
 * sorting, filtering and find matching are unit-tested alongside
 * CommunicationView.
 */

import { expect, test } from "./fixtures/app";
import { serveEvalFiles } from "./fixtures/serve-eval-file";

// fixtures/communication/generate_log.py: sample "swarm" is a two-member
// inspect_swarm swarm; sample "plain" has no communication.
const fixture = {
  path: new URL("./fixtures/communication/swarm.eval", import.meta.url),
  logFile: "swarm.eval",
  preview: { task: "task", model: "mockllm/model", status: "success" },
};

const sampleUrl = (sample: string, tab: string) =>
  `/#/logs/swarm.eval/samples/sample/${sample}/1/${tab}`;

test("a swarm sample's Communication tab deep-links to its messages", async ({
  page,
  network,
}) => {
  serveEvalFiles(network, [fixture]);
  await page.goto(sampleUrl("swarm", "transcript"));
  const findInput = page.getByPlaceholder("Find");
  const selected = page.getByRole("region", { name: "Selected row" });

  // The page's find, left open on Transcript, gives way to the grid's.
  await expect(page.getByRole("tab", { name: "Communication" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(findInput).toHaveCount(1);
  await page.getByRole("tab", { name: "Communication" }).click();
  await expect(page).toHaveURL(/\/samples\/sample\/swarm\/1\/communication$/);

  const grid = page.getByRole("grid", { name: "Communication" });
  // The long message is a log attachment; its row previews the text.
  await expect(
    grid.getByRole("row").filter({ hasText: "please check a.md" })
  ).toBeVisible();
  await expect(findInput).toHaveCount(0);
  // The write is addressed to no one; it was news to bob.
  await expect(
    grid.getByRole("row").filter({ hasText: "create" })
  ).toContainText("bob");
  const refused = grid.getByRole("row").filter({ hasText: "Refused (rate)" });
  await expect(refused).toBeVisible();

  // Find searches whole messages, past a row's preview, and shows the match
  // in full below the grid.
  await page.keyboard.press("ControlOrMeta+f");
  await findInput.fill("step 39");
  await expect(findInput).toHaveCount(1);
  await expect(page.getByTestId("find-band-match-count")).toHaveText("1 of 1");
  await expect(
    selected.getByRole("article", { name: "message from alice", exact: true })
  ).toContainText("Delivered (#1) to bob");

  // So does a click on a row.
  await refused.click();
  await expect(
    selected.getByRole("article", { name: "Refused message from alice" })
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Communication" })
  ).toHaveAttribute("aria-selected", "true");
  await expect(grid.getByText("m-1 from alice", { exact: true })).toBeVisible();
});

test("a sample without communication shows the Transcript, with its controls", async ({
  page,
  network,
}) => {
  serveEvalFiles(network, [fixture]);
  // Reached from a communicating sibling, the tab the route keeps is
  // Communication, which this sample does not have.
  await page.goto(sampleUrl("swarm", "communication"));
  await expect(
    page.getByRole("grid", { name: "Communication" }).getByRole("row").nth(1)
  ).toBeVisible();
  await page.getByRole("link", { name: "Previous sample" }).click();
  await expect(page).toHaveURL(/\/samples\/sample\/plain\/1\/communication$/);

  await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByRole("tab", { name: "Communication" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Events: / })).toBeVisible();

  // Print prints the Transcript shown, by button and by shortcut.
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print" }).click();
  await expect(await popup).toHaveURL(/view=transcript/);
  const shortcutPopup = page.waitForEvent("popup");
  await page.keyboard.press("ControlOrMeta+p");
  await expect(await shortcutPopup).toHaveURL(/view=transcript/);
});

test("the Communication tab offers no print, by button or shortcut", async ({
  page,
  network,
}) => {
  serveEvalFiles(network, [fixture]);
  let popups = 0;
  page.on("popup", () => {
    popups += 1;
  });
  await page.goto(sampleUrl("swarm", "communication"));
  await expect(
    page.getByRole("grid", { name: "Communication" }).getByRole("row").nth(1)
  ).toBeVisible();

  // The print route has no Communication view: nothing would print.
  await expect(page.getByRole("button", { name: "Print" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+p");

  // The Transcript tab still prints from both; its popup comes after the
  // keypress above would have opened one.
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("ControlOrMeta+p");
  const printPage = await popup;
  await expect(printPage).toHaveURL(/view=transcript/);
  expect(popups).toBe(1);
});

test("the Multiline view option shows three lines of each message", async ({
  page,
  network,
}) => {
  serveEvalFiles(network, [fixture]);
  await page.goto(sampleUrl("swarm", "communication"));
  const row = page
    .getByRole("grid", { name: "Communication" })
    .getByRole("row")
    .filter({ hasText: "please check a.md" });
  const content = row
    .getByRole("gridcell")
    .filter({ hasText: "please check a.md" })
    .locator("> div");
  const lines = () =>
    content.evaluate((el) => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      return Math.round(el.getBoundingClientRect().height / lineHeight);
    });
  const height = async () => (await row.boundingBox())?.height ?? 0;

  await expect(row).toBeVisible();
  expect(await lines()).toBe(1);
  const singleHeight = await height();

  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("checkbox", { name: "Multiline" }).check();

  // The message has many lines; the cell shows its first three.
  await expect.poll(lines).toBe(3);
  expect(await height()).toBeGreaterThan(singleHeight);
});
