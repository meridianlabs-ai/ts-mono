import { expect, test } from "../fixtures/app";
import { serveEvalLog } from "../fixtures/serve-log";

import {
  canaryLog,
  kCanaryFormulaCount,
  kTerminalText,
  mainLog,
} from "./cspLogs";

// Runs against the production build under `vite preview`, which sends the
// built policy as a header the way `inspect view` does (see
// playwright.config.ts and contentSecurityPolicy); the dev server sends none.
// The `cspViolations` fixture fails any spec whose page reports a violation;
// these cover what no other spec renders, or where a block stays silent.

const isDirectives = (value: unknown): value is Record<string, string[]> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every(
    (sources) =>
      Array.isArray(sources) &&
      sources.every((source) => typeof source === "string")
  );

/** The policy file's directives as `name sources…` strings, in file order. */
const policyFileDirectives = (file: unknown): string[] =>
  typeof file === "object" &&
  file !== null &&
  "directives" in file &&
  isDirectives(file.directives)
    ? Object.entries(file.directives).map(([name, sources]) =>
        [name, ...sources].join(" ")
      )
    : [];

const sampleUrl = (file: string, id: string, tab: string) =>
  `/#/logs/${encodeURIComponent(file)}/samples/sample/${id}/1/${tab}`;

test("the preview serves the built policy file as its header", async ({
  request,
}) => {
  const response = await request.get("/");
  // Delivered by the host (here as a header), never baked into index.html,
  // where it would also bind hosts that can't strip it (VS Code).
  expect(await response.text()).not.toContain("Content-Security-Policy");
  const header = response.headers()["content-security-policy"] ?? "";

  const file: unknown = await (
    await request.get("/content-security-policy.json")
  ).json();
  expect(file).toMatchObject({ version: 1 });
  expect(header).toContain("default-src 'none'");
  expect(policyFileDirectives(file).join("; ")).toBe(header);
});

// The worker check covers the app wiring the JSON parser to its worker
// (configureJsonParseWorker): without it, parsing silently stays on the main
// thread.
test("a large log parses in the app's JSON worker, and its data: audio and video load", async ({
  page,
  network,
}) => {
  serveEvalLog(network, mainLog, "csp-main.json");
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  // Logged when the worker can't start and parsing falls back to the main
  // thread, which still renders the log.
  const fallbacks: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("JSON parse worker unavailable")) {
      fallbacks.push(message.text());
    }
  });
  await page.goto(sampleUrl("csp-main.json", "media", "messages"));
  for (const selector of ["audio", "video"]) {
    await expect
      .poll(() =>
        page
          .locator(selector)
          .first()
          .evaluate((element: HTMLMediaElement) => element.readyState)
      )
      .toBeGreaterThanOrEqual(1);
  }
  expect(workers).toContainEqual(expect.stringContaining("json-parse.worker"));
  expect(fallbacks).toEqual([]);
});

// CodeMirror styles itself through style-mod, which patches/style-mod.patch
// moves from a <style> tag to an adopted stylesheet.
test("the filter editor gets CodeMirror's styles", async ({
  page,
  network,
}) => {
  serveEvalLog(network, mainLog, "csp-main.json");
  await page.goto(`/#/logs/${encodeURIComponent("csp-main.json")}/samples`);
  await expect(page.locator(".cm-editor").first()).toHaveCSS("display", "flex");
});

// Blocking WebAssembly reports no violation, so only the drawn text shows it.
test("the human-baseline terminal draws its session", async ({
  page,
  network,
}) => {
  serveEvalLog(network, mainLog, "csp-main.json");
  await page.goto(sampleUrl("csp-main.json", "terminal", "transcript"));
  await page.getByText("Terminal Session").click();
  await expect(page.locator(".ap-player").first()).toContainText(kTerminalText);
});

// The page emulates a dark color scheme while the static HTML says light, so
// "dark" at <body> can only come from the hashed inline bootstrap, so this
// fails if the build's hashes are wrong. Resolving the preference is
// unit-tested in @tsmono/theme.
test("the theme bootstrap applies the system theme before the body parses", async ({
  page,
  network,
}) => {
  serveEvalLog(network, mainLog, "csp-main.json");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem(
      "inspect-view-user-settings",
      JSON.stringify({ state: { themePreference: "system" }, version: 0 })
    );
    // The theme at the moment <body> is inserted, before any module script
    // or first paint: what the inline bootstrap alone decided.
    new MutationObserver((_records, observer) => {
      if (!document.querySelector("body")) return;
      observer.disconnect();
      const root = document.documentElement;
      root.dataset.themeAtBody = `${root.dataset.bsTheme}/${root.style.colorScheme}`;
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto("/#/logs/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-at-body",
    "dark/dark"
  );
});

// The cspViolations fixture fails the test if any vector fetches, runs a
// handler, or leaves one for the sanitizer to parse (Chromium 156+ reports
// that too). Fetches start at style and paint time, so the test waits for
// two frames after the formulas render.
test("rendering vectors cause no CSP report", async ({ page, network }) => {
  serveEvalLog(network, canaryLog, "csp-canary.json");
  await page.goto(sampleUrl("csp-canary.json", "canary", "messages"));

  await expect(page.locator("mjx-container")).toHaveCount(kCanaryFormulaCount);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
});
