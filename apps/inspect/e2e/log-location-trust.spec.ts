/**
 * A link may propose a log location but not set one (#615). The browser-hosted
 * viewer refuses an origin named only by `?log_dir=` / `?log_file=`, a hash
 * route, or a window message. A request to that origin would be blocked by the
 * viewer's CSP before MSW sees it, so these specs don't count requests there;
 * the `cspViolations` fixture fails them on the blocked request instead.
 */
import type { NetworkFixture } from "@msw/playwright";
import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";

const FOREIGN_ORIGIN = "https://bucket.example";
const FOREIGN_DIR = `${FOREIGN_ORIGIN}/team/logs`;

/** An empty same-origin static log dir under the dev server. */
const serveLocalDir = (network: NetworkFixture) => {
  const hits: string[] = [];
  network.use(
    http.get("*/logs/listing.json", ({ request }) => {
      hits.push(request.url);
      return HttpResponse.json({});
    })
  );
  return hits;
};

test("a cross-origin ?log_dir= is refused, and continuing drops it", async ({
  page,
}) => {
  await page.goto(`/?log_dir=${encodeURIComponent(FOREIGN_DIR)}`);

  const gate = page.getByTestId("log-location-gate");
  await expect(
    gate.getByRole("heading", {
      name: `Can't open logs from ${FOREIGN_ORIGIN}`,
    })
  ).toBeVisible();
  await expect(gate.getByText(FOREIGN_DIR, { exact: true })).toBeVisible();

  await gate.getByRole("button", { name: "Continue without it" }).click();

  await expect(page).not.toHaveURL(/log_dir=/);
  await expect(gate).toBeHidden();
});

test("a same-origin ?log_dir= is the page's own scope and loads unprompted", async ({
  page,
  network,
}) => {
  const hits = serveLocalDir(network);

  await page.goto("/?log_dir=logs");

  await expect.poll(() => hits.length).toBeGreaterThan(0);
  await expect(page.getByTestId("log-location-gate")).toBeHidden();
});

test("a hash route naming another origin is refused", async ({
  page,
  network,
}) => {
  serveLocalDir(network);

  await page.goto(
    `/?log_dir=logs#/logs/${encodeURIComponent(`${FOREIGN_DIR}/run.eval`)}`
  );

  const errorPanel = page.getByTestId("error-panel");
  await expect(errorPanel).toBeVisible();
  await expect(errorPanel).toContainText(
    "outside the configured log directory"
  );
});

test("a window updateState message is ignored outside VS Code", async ({
  page,
  network,
}) => {
  const logFileRequests: string[] = [];
  network.use(
    // get_log_root — the dir-mode gate blocks on this.
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", ({ request }) => {
      logFileRequests.push(request.url);
      return HttpResponse.json({ files: [], response_type: "full" });
    })
  );

  await page.goto("/");
  await expect.poll(() => logFileRequests.length).toBeGreaterThan(0);
  const requestsBefore = logFileRequests.length;

  await page.evaluate((url) => {
    window.postMessage({ type: "updateState", url }, "*");
  }, `${FOREIGN_DIR}/run.eval`);
  await page.waitForTimeout(300);

  expect(
    logFileRequests
      .slice(requestsBefore)
      .filter((url) => url.includes("bucket"))
  ).toEqual([]);
});
