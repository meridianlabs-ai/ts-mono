/**
 * A link may propose a log location but not set one (#615). The browser-hosted
 * viewer must not contact an origin named only by `?log_dir=` / `?log_file=`, a
 * hash route, or a window message until the user has approved it.
 */
import type { NetworkFixture } from "@msw/playwright";
import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";

const FOREIGN_ORIGIN = "https://bucket.example";
const FOREIGN_DIR = `${FOREIGN_ORIGIN}/team/logs`;

/** Serve an empty static log dir at the foreign origin and count every request
 *  the viewer makes to that origin. */
const serveForeignDir = (network: NetworkFixture) => {
  const hits: string[] = [];
  network.use(
    http.get(`${FOREIGN_ORIGIN}/*`, ({ request }) => {
      hits.push(request.url);
      return request.url.endsWith("/listing.json")
        ? HttpResponse.json({})
        : new HttpResponse(null, { status: 404 });
    })
  );
  return hits;
};

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

test("a cross-origin ?log_dir= waits for approval before anything is fetched", async ({
  page,
  network,
}) => {
  const hits = serveForeignDir(network);

  await page.goto(`/?log_dir=${encodeURIComponent(FOREIGN_DIR)}`);

  const gate = page.getByTestId("log-location-gate");
  await expect(gate).toBeVisible();
  await expect(
    gate.getByRole("heading", { name: `Open logs from ${FOREIGN_ORIGIN}?` })
  ).toBeVisible();
  await expect(gate.getByText(FOREIGN_DIR, { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  expect(hits).toEqual([]);

  await gate.getByRole("button", { name: "Open", exact: true }).click();

  await expect(gate).not.toBeVisible();
  await expect.poll(() => hits).toContain(`${FOREIGN_DIR}/listing.json`);
});

test("declining strips the proposal from the URL without contacting it", async ({
  page,
  network,
}) => {
  const hits = serveForeignDir(network);

  await page.goto(
    `/?log_file=${encodeURIComponent(`${FOREIGN_DIR}/run.eval`)}`
  );
  const gate = page.getByTestId("log-location-gate");
  await expect(gate).toBeVisible();

  await gate.getByRole("button", { name: "Don't open" }).click();

  await expect(page).not.toHaveURL(/log_file=/);
  await expect(gate).not.toBeVisible();
  // The dev server has no view server, so the page settles on the config
  // error; what matters is that the foreign origin was never contacted.
  await page.waitForTimeout(300);
  expect(hits).toEqual([]);
});

test("a same-origin ?log_dir= is the page's own scope and loads unprompted", async ({
  page,
  network,
}) => {
  const hits = serveLocalDir(network);

  await page.goto("/?log_dir=logs");

  await expect.poll(() => hits.length).toBeGreaterThan(0);
  await expect(page.getByTestId("log-location-gate")).not.toBeVisible();
});

test("a hash route naming another origin is refused, not fetched", async ({
  page,
  network,
}) => {
  serveLocalDir(network);
  const foreignHits = serveForeignDir(network);

  await page.goto(
    `/?log_dir=logs#/logs/${encodeURIComponent(`${FOREIGN_DIR}/run.eval`)}`
  );

  const errorPanel = page.getByTestId("error-panel");
  await expect(errorPanel).toBeVisible();
  await expect(errorPanel).toContainText(
    "outside the configured log directory"
  );
  expect(foreignHits).toEqual([]);
});

test("a window updateState message is ignored outside VS Code", async ({
  page,
  network,
}) => {
  const foreignHits = serveForeignDir(network);
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

  expect(foreignHits).toEqual([]);
  expect(
    logFileRequests
      .slice(requestsBefore)
      .filter((url) => url.includes("bucket"))
  ).toEqual([]);
});
