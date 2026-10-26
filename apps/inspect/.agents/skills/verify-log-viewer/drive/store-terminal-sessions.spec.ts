import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

// Real-backend drive for the Terminals tab: a sample whose store holds
// asciinema:* keys plays them as asciicasts in a Terminals tab and keeps those
// keys out of the Info tab's Store record tree.
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

test("store asciicasts play in a Terminals tab, filtered from the store tree", async ({
  page,
}) => {
  test.skip(
    findCastsLog() === undefined,
    "no viewer-casts fixture in VERIFY_LOG_DIR"
  );
  const castsLog = castsLogOrThrow();
  await page.goto(
    `/#/logs/${encodeURIComponent(castsLog)}/samples/sample/1/1/terminals`
  );

  // One paused preview tile per asciinema:* key.
  await expect(page.getByRole("tab", { name: "Terminals" })).toBeVisible({
    timeout: 15_000,
  });
  const mainTile = page.getByRole("button", {
    name: "Play terminal terminal-main",
  });
  await expect(mainTile).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play terminal terminal-listener" })
  ).toBeVisible();

  // Clicking a tile opens it full-viewport and plays the recorded output.
  await mainTile.click();
  const dialog = page.getByRole("dialog", { name: "Terminal terminal-main" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("nmap -sV 10.0.20.5").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: join(evidence, "store-terminal-sessions-expanded.png"),
  });

  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The Info tab's Store card keeps non-cast keys and holds no asciinema:*
  // entries.
  await page.getByRole("tab", { name: "Info" }).click();
  await expect(page.getByText("inspect_ranges:evidence")).toBeVisible();
  await expect(page.getByText("asciinema:terminal-main")).toHaveCount(0);

  await page.screenshot({
    path: join(evidence, "store-terminal-sessions.png"),
    fullPage: true,
  });
});
