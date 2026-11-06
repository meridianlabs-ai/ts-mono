import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// Real-backend drive for the Terminals tab: a sample whose store holds
// asciinema:* casts shows every session stacked on one shared clock, offers
// an agent picker when the casts come from several agents, and keeps the cast
// keys out of the Info tab's Store record tree.
//
// Fixtures: the software-engineering logs that
// `fixtures/make_multiterminal_fixtures.py --out-dir <VERIFY_LOG_DIR>` writes
// — `*_fix-failing-tests_*.eval` (one agent; sessions main, server, tests,
// build; store key `webapp:ticket`) and `*_fix-failing-tests-multiagent_*.eval`
// (tests and build owned by a `test-runner` subagent).

const evidence = join(import.meta.dirname, "..", "evidence");

const logDir =
  process.env.VERIFY_LOG_DIR ?? join(homedir(), "code/viewer-validation/logs");

const findLog = (pattern: RegExp): string | undefined => {
  try {
    return readdirSync(logDir).find((name) => pattern.test(name));
  } catch {
    return undefined;
  }
};

const singleAgentLog = findLog(/_fix-failing-tests_.*\.eval$/);
const multiAgentLog = findLog(/_fix-failing-tests-multiagent_.*\.eval$/);

const sampleUrl = (log: string | undefined, rest: string): string => {
  if (log === undefined) {
    throw new Error("gate with test.skip(log === undefined) first");
  }
  return `/#/logs/${encodeURIComponent(log)}/samples/sample/fix-failing-tests/1/${rest}`;
};

const readout = (page: Page) => page.getByLabel("Elapsed in the run");

// "12:34 / 49:43" → 754; "1:02:10 / …" → 3730.
const clockSeconds = (text: string | null): number =>
  (text ?? "")
    .replace(/\/.*/, "")
    .trim()
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);

const row = (page: Page, session: string) =>
  page.locator(`[data-session="${session}"]`);

test.beforeAll(() => {
  mkdirSync(evidence, { recursive: true });
});

test("terminals share one clock", async ({ page }) => {
  test.skip(
    singleAgentLog === undefined,
    "no fix-failing-tests fixture in VERIFY_LOG_DIR"
  );

  // The first visit plays from the start, following the agent's terminal.
  await page.goto(sampleUrl(singleAgentLog, "terminals"));
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-state="focused"]')).toHaveCount(1);
  // One agent: no agent picker.
  await expect(page.getByRole("button", { name: /terms?$/ })).toHaveCount(0);
  // Space pauses and plays with focus on the page body.
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  // Leaving the tab while playing, the view comes back playing from where it
  // was.
  const leftAt = clockSeconds(await readout(page).textContent());
  await page.getByRole("tab", { name: "Info" }).click();
  await page.getByRole("tab", { name: "Terminals" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(
    clockSeconds(await readout(page).textContent())
  ).toBeGreaterThanOrEqual(leftAt);

  // ] steps the clock to the agent's next command; a pause sticks across a
  // tab switch. (Focus is on the tab bar, which keeps its own keys.)
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.keyboard.press("]");
  const stepped = (await readout(page).textContent()) ?? "";
  await page.getByRole("tab", { name: "Info" }).click();
  await page.getByRole("tab", { name: "Terminals" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(readout(page)).toHaveText(stepped);
  // The tab collapses the sample header (the input block goes).
  await expect(page.getByText(/The webapp test suite is failing/)).toHaveCount(
    0
  );
  await page.screenshot({ path: join(evidence, "terminals-shared-view.png") });

  // Fullscreen covers the viewport, on the same clock;
  // Escape leaves it.
  const paused = (await readout(page).textContent()) ?? stepped;
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  const fill = page.getByRole("region", {
    name: "Terminals fullscreen",
  });
  await expect(fill).toBeVisible();
  const fillBox = await fill.boundingBox();
  expect(fillBox?.height).toBe(page.viewportSize()?.height);
  await expect(readout(page)).toHaveText(paused);
  await page.screenshot({ path: join(evidence, "terminals-fullscreen.png") });
  await page.keyboard.press("Escape");
  await expect(fill).toHaveCount(0);
  // The control row offers the same way in.
  await page.getByRole("button", { name: "Show terminals fullscreen" }).click();
  await expect(fill).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show terminals fullscreen" })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(fill).toHaveCount(0);

  // Leaving the tab gives the header back (it was expanded before). The Info
  // tab's Store card keeps non-cast keys and holds no asciinema:* entries.
  await page.getByRole("tab", { name: "Info" }).click();
  await expect(
    page.getByText(/The webapp test suite is failing/)
  ).toBeVisible();
  await expect(page.getByText("webapp:ticket")).toBeVisible();
  await expect(page.getByText("asciinema:terminal-main")).toHaveCount(0);
});

test("the agent picker swaps agents on the same clock", async ({ page }) => {
  test.skip(
    multiAgentLog === undefined,
    "no fix-failing-tests-multiagent fixture in VERIFY_LOG_DIR"
  );

  await page.goto(sampleUrl(multiAgentLog, "terminals"));
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.keyboard.press("]");
  const before = (await readout(page).textContent()) ?? "";
  await expect(row(page, "main")).toBeVisible();
  await expect(row(page, "tests")).toHaveCount(0);

  await page.getByRole("button", { name: /^main\s*·\s*2 terms$/ }).click();
  await expect(page.getByText("Agents in this sample")).toBeVisible();
  await page.getByRole("button", { name: /test-runner/ }).click();

  await expect(
    page.getByRole("button", { name: /^test-runner\s*·\s*2 terms$/ })
  ).toBeVisible();
  await expect(row(page, "main")).toHaveCount(0);
  await expect(readout(page)).toHaveText(before);

  // ] now steps through the subagent's commands, focusing its terminal.
  await page.keyboard.press("]");
  await expect(page.locator('[data-state="focused"]')).toHaveAttribute(
    "data-session",
    /^(tests|build)$/
  );
  await page.screenshot({ path: join(evidence, "terminals-subagent.png") });
});
