/**
 * Sample Communication tab e2e tests: the tab's visibility and routing on a
 * real swarm log, read through the zip with its attachments resolved. The
 * rows, the send/delivery join and the filters are unit-tested alongside
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

  await page.getByRole("tab", { name: "Communication" }).click();
  await expect(page).toHaveURL(/\/samples\/sample\/swarm\/1\/communication$/);

  const first = page.getByRole("article", {
    name: "message from alice",
    exact: true,
  });
  // The long message is a log attachment; the tab shows its text.
  await expect(first).toContainText("Hi bob, please check a.md.");
  await expect(first).toContainText("Delivered (#1) to bob");
  await expect(
    page.getByRole("article", { name: "Refused message from alice" })
  ).toContainText("Refused (rate)");

  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Communication" })
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("article", { name: "message from bob", exact: true })
  ).toContainText("reply to m-1 from alice");
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
    page.getByRole("article", { name: "message from bob", exact: true })
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
    page.getByRole("article", { name: "message from bob", exact: true })
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
