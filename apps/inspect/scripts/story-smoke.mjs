// Browser smoke test for the App/FullApp Storybook stories.
//
// Loads each story's Storybook iframe in headless Chromium and asserts the
// story renders its intended content with no unexpected network failures or
// uncaught JS errors. This tests the REAL stories in Storybook (MSW service
// worker + the full <App/>), unlike an @msw/playwright e2e run against the app
// dev server, which exercises different handler-merge semantics.
//
// Usage:
//   pnpm --filter @meridianlabs/log-viewer story-smoke           # all known stories
//   node scripts/story-smoke.mjs app-fullapp--error-state ...    # specific ids
//
// Requires Storybook running on http://localhost:6006.
import { chromium } from "@playwright/test";

const BASE = process.env.STORYBOOK_URL ?? "http://localhost:6006";

// Per-story content expectations. Stories not listed here are smoke-checked
// for errors only.
const EXPECTATIONS = {
  "app-fullapp--log-listing": { expect: ["math-eval"] },
  "app-fullapp--completed-eval-synthetic": {
    expect: ["List files in the /tmp directory"],
  },
  "app-fullapp--completed-eval-real-data": { expect: ["Hey there, hipster"] },
  "app-fullapp--running-eval": {
    expect: ["RUNNING"],
    notExpect: ["An error occurred while loading"],
  },
  "app-fullapp--error-state": {
    expect: ["TASK FAILED"],
    notExpect: ["An error occurred while loading"],
  },
};

// 404s that are correct protocol, not bugs:
//  - pending-samples: HTTP 404 IS the "NotFound" signal for non-running evals
//  - eval-set / flow: optional resources; absence is signalled with 404
const EXPECTED_404 = ["/pending-samples", "/eval-set", "/flow"];

// Known, non-fatal background error: the full app's overview route races two
// syncLogs calls in Storybook; the second skips replication setup. Views still
// render correctly. Tolerated but reported.
const TOLERATED_ERRORS = ["No database available for replication"];

const ids = process.argv.slice(2);
const targets = ids.length ? ids : Object.keys(EXPECTATIONS);

const browser = await chromium.launch();
let anyFail = false;

for (const id of targets) {
  const { expect = [], notExpect = [] } = EXPECTATIONS[id] ?? {};
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  const apiFail = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("response", (r) => {
    const u = r.url();
    if (
      u.includes("/api/") &&
      r.status() >= 400 &&
      !EXPECTED_404.some((p) => u.includes(p))
    ) {
      apiFail.push(`${r.status()} ${u.replace(/\?.*/, "")}`);
    }
  });

  await page.goto(`${BASE}/iframe.html?id=${id}&viewMode=story`, {
    waitUntil: "domcontentloaded",
  });
  const readBody = async () =>
    (
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || ""
    )
      .replace(/\s+/g, " ")
      .trim();

  // Poll for the expected content instead of a fixed sleep. For stories with
  // no content assertion, give the page a brief settle before the error checks.
  const DEADLINE_MS = 10000;
  const POLL_MS = 250;
  let body = await readBody();
  if (expect.length) {
    const start = Date.now();
    while (
      expect.some((t) => !body.includes(t)) &&
      Date.now() - start < DEADLINE_MS
    ) {
      await page.waitForTimeout(POLL_MS);
      body = await readBody();
    }
  } else {
    await page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => {});
    body = await readBody();
  }

  const missing = expect.filter((t) => !body.includes(t));
  const present = notExpect.filter((t) => body.includes(t));
  const fatalErrors = pageErrors.filter(
    (e) => !TOLERATED_ERRORS.some((t) => e.includes(t))
  );
  const tolerated = pageErrors.filter((e) =>
    TOLERATED_ERRORS.some((t) => e.includes(t))
  );
  const fail =
    missing.length || present.length || apiFail.length || fatalErrors.length;
  if (fail) anyFail = true;

  console.log(`\n===== ${id} =====`);
  console.log(`  body(170): ${JSON.stringify(body.slice(0, 170))}`);
  if (missing.length) console.log(`  MISSING expected: ${missing.join(", ")}`);
  if (present.length)
    console.log(`  UNEXPECTED present: ${present.join(", ")}`);
  if (apiFail.length) console.log(`  API FAIL: ${apiFail.join(" | ")}`);
  if (fatalErrors.length)
    console.log(`  PAGEERRORS: ${fatalErrors.join(" || ")}`);
  if (tolerated.length)
    console.log(`  tolerated(known): ${[...new Set(tolerated)].join(" || ")}`);
  console.log(`  => ${fail ? "FAIL" : "PASS"}`);
  await ctx.close();
}

await browser.close();
console.log(`\nOVERALL: ${anyFail ? "FAIL" : "PASS"}`);
process.exit(anyFail ? 1 : 0);
