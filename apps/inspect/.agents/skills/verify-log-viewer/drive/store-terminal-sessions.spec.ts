import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

// Real-backend drive for the Terminal Sessions card: a sample whose store
// holds asciinema:* keys plays them as asciicasts on the Metadata tab and
// keeps those keys out of the Store record tree.
//
// Fixture: any viewer-casts .eval in VERIFY_LOG_DIR — one sample whose store
// holds `asciinema:terminal-main` (first output line `$ nmap -sV 10.0.20.5`),
// `asciinema:terminal-listener` (first output line `$ nc -lvnp 4444`), and
// the non-cast key `inspect_ranges:evidence`. Generate one with a mockllm
// task whose solver writes those keys via `store().set(...)`.

const evidence = join(import.meta.dirname, "..", "evidence");

const findCastsLog = (): string | undefined => {
  const logDir =
    process.env.VERIFY_LOG_DIR ??
    join(homedir(), "code/viewer-validation/logs");
  try {
    return readdirSync(logDir).find((name) =>
      /viewer-casts.*\.eval$/.test(name)
    );
  } catch {
    return undefined;
  }
};

const castsLogOrThrow = (): string => {
  const log = findCastsLog();
  if (log === undefined) {
    throw new Error("gate with test.skip(findCastsLog() === undefined) first");
  }
  return log;
};

test.beforeAll(() => {
  mkdirSync(evidence, { recursive: true });
});

test("store asciicasts play in a Terminal Sessions card, filtered from the store tree", async ({
  page,
}) => {
  test.skip(
    findCastsLog() === undefined,
    "no viewer-casts fixture in VERIFY_LOG_DIR"
  );
  const castsLog = castsLogOrThrow();
  await page.goto(
    `/#/logs/${encodeURIComponent(castsLog)}/samples/sample/1/1/metadata`
  );

  // The card renders with one labeled player per asciinema:* key.
  await expect(
    page.getByText("Terminal Sessions", { exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("terminal-main").first()).toBeVisible();
  await expect(page.getByText("terminal-listener").first()).toBeVisible();

  // The players parsed the casts: asciinema-player mounts its terminal UI
  // and autoplay writes the recorded output into it.
  const players = page.locator("div[id^='asciinema-player-']");
  await expect(players).toHaveCount(2);
  await expect(page.getByText("nmap -sV 10.0.20.5").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("nc -lvnp 4444").first()).toBeVisible();

  // The Store card keeps non-cast keys and holds no asciinema:* entries.
  await expect(page.getByText("inspect_ranges:evidence")).toBeVisible();
  await expect(page.getByText("asciinema:terminal-main")).toHaveCount(0);

  await page.screenshot({
    path: join(evidence, "store-terminal-sessions.png"),
    fullPage: true,
  });
});
