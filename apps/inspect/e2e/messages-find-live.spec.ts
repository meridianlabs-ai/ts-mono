/**
 * Find on a RUNNING sample, against a real view server (opt-in: needs
 * E2E_LOG_DIR pointing at the log dir of an eval that is still writing, and
 * VIEW_SERVER_URL for vite's proxy). For example, from the inspect_ai root:
 *
 *   inspect view start --port 7590 --log-dir logs/find-qa-live &
 *   inspect eval logs/find-qa-live/live_task.py --model mockllm/model \
 *     --log-dir logs/find-qa-live --log-shared 1 --display none &
 *   E2E_LOG_DIR=$PWD/logs/find-qa-live VIEW_SERVER_URL=http://127.0.0.1:7590 \
 *     pnpm --filter @meridianlabs/log-viewer exec playwright test messages-find-live
 *
 * The ticker appends an assistant message every 1.5 s for a minute.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/app";

const LOG_DIR = process.env.E2E_LOG_DIR;

function newestEval(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".eval"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]!.f;
}

const activeAnchor = (page: Page) =>
  page.evaluate(() => {
    const r = [...(CSS.highlights.get("find-active") ?? [])][0];
    return r instanceof Range
      ? (r.startContainer.parentElement
          ?.closest("[data-find-anchor]")
          ?.getAttribute("data-find-anchor") ?? null)
      : null;
  });

const countOf = (band: string) => Number(band.match(/of (\d+)\+/)![1]);

test.skip(
  LOG_DIR === undefined,
  "needs a real view server and a running eval (see the file header)"
);

test("a running sample: the count stays a lower bound, a wrap lands on the last hit and stays there while rows append", async ({
  page,
}) => {
  const logFile = newestEval(LOG_DIR!);
  await page.goto(
    `/#/logs/${encodeURIComponent(logFile)}/samples/sample/1/1/messages`
  );
  await expect(
    page.getByText("Default output from mockllm/model").first()
  ).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Find");
  await input.fill("default output");
  const count = page.getByTestId("find-band-match-count");
  await expect(count).toHaveText(/^1 of \d+\+$/);

  await input.press("Shift+Enter");
  await expect(count).toHaveText(/^(\d+) of \1\+$/);
  const wrapped = (await count.textContent()) ?? "";
  await expect.poll(() => activeAnchor(page)).not.toBeNull();
  const anchor = await activeAnchor(page);

  // Appends land (the ticker is still running): M grows, the active row
  // stays the same anchor and is not scrolled away.
  await expect
    .poll(async () => countOf((await count.textContent()) ?? ""), {
      timeout: 15_000,
    })
    .toBeGreaterThan(countOf(wrapped));
  expect(await activeAnchor(page)).toBe(anchor);
});
