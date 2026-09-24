import { createHash } from "node:crypto";

import type { NetworkFixture } from "@msw/playwright";
import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";

import type { EvalLog } from "@tsmono/inspect-common/types";

import { expect, test } from "../fixtures/app";
import { serveEvalLog } from "../fixtures/serve-log";

import { canaryLog, kProbeHost, kTerminalText, mainLog } from "./cspLogs";

// Runs against the production build under `vite preview`, which sends the
// built policy as a header the way `inspect view` does (see
// playwright.config.ts and contentSecurityPolicy); the dev server sends none.

// Pinned deliberately: loosening the viewer's CSP should mean editing this
// line. HASHES stands for the build's inline-script hashes.
const kExpectedPolicy =
  "default-src 'none'; script-src 'self' HASHES 'wasm-unsafe-eval'; " +
  "worker-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; " +
  "img-src 'self' data:; media-src data:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; frame-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

declare global {
  interface Window {
    __cspViolations: string[];
    __workerMessages: string[];
  }
}

/**
 * Record every CSP violation the page reports, from the first script on,
 * and every request that leaves the viewer's origin. Playwright reports a
 * request the policy blocked too (failing with "csp"), so those don't count
 * as leaving.
 */
const watchPolicy = async (page: Page, baseURL: string | undefined) => {
  const origin = new URL(baseURL ?? "").origin;
  const consoleErrors: string[] = [];
  const requested: string[] = [];
  const blocked = new Set<string>();
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["data:", "blob:"].includes(url.protocol) && url.origin !== origin) {
      requested.push(request.url());
    }
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "csp") blocked.add(request.url());
  });
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.addInitScript(() => {
    window.__workerMessages = [];
    const original: unknown = Reflect.get(Worker.prototype, "postMessage");
    if (typeof original !== "function") return;
    Object.defineProperty(Worker.prototype, "postMessage", {
      value(this: Worker, message: unknown, ...rest: unknown[]) {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message
        ) {
          window.__workerMessages.push(String(message.type));
        }
        Reflect.apply(original, this, [message, ...rest]);
      },
    });
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push(
        `${event.effectiveDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`
      );
    });
  });
  return {
    violations: async (): Promise<string[]> => [
      ...(await page.evaluate(() => window.__cspViolations)),
      ...consoleErrors,
    ],
    offOrigin: (): string[] => requested.filter((url) => !blocked.has(url)),
    workers,
    workerMessages: (): Promise<string[]> =>
      page.evaluate(() => window.__workerMessages),
  };
};

/** Serve one log for both the log list and deep links into it. */
const serveLog = (network: NetworkFixture, evalLog: EvalLog, file: string) => {
  serveEvalLog(network, evalLog, file);
  network.use(
    http.get("*/api/log-dir", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [
          { name: `/logs/${file}`, task: "test-task", task_id: "test-task" },
        ],
        response_type: "full",
      })
    )
  );
};

const isDirectives = (value: unknown): value is Record<string, string[]> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every(
    (sources) =>
      Array.isArray(sources) &&
      sources.every((source) => typeof source === "string")
  );

const sampleUrl = (file: string, id: string, tab: string) =>
  `/#/logs/${encodeURIComponent(file)}/samples/sample/${id}/1/${tab}`;

test("the build ships the pinned policy, hashing each inline script", async ({
  request,
}) => {
  const response = await request.get("/");
  const html = await response.text();
  // Delivered by the host (here as a header), never baked into index.html,
  // where it would also bind hosts that can't strip it (VS Code).
  expect(html).not.toContain("Content-Security-Policy");
  const policy = response.headers()["content-security-policy"] ?? "";

  const inlineHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    ([, code]) =>
      `'sha256-${createHash("sha256")
        .update(code ?? "")
        .digest("base64")}'`
  );
  expect(inlineHashes.length).toBeGreaterThan(0);
  expect(policy).toBe(
    kExpectedPolicy.replace("HASHES", inlineHashes.join(" "))
  );

  // The file hosts read the policy from says the same thing.
  const file: unknown = await (
    await request.get("/content-security-policy.json")
  ).json();
  expect(file).toMatchObject({ version: 1 });
  const directives =
    typeof file === "object" &&
    file !== null &&
    "directives" in file &&
    isDirectives(file.directives)
      ? Object.entries(file.directives)
      : [];
  expect(
    directives.map(([name, sources]) => [name, ...sources].join(" ")).join("; ")
  ).toBe(policy);
});

test("the main flows run with no CSP violation", async ({
  page,
  network,
  baseURL,
}) => {
  serveLog(network, mainLog, "csp-main.json");
  const policy = await watchPolicy(page, baseURL);

  // Log list, then a log's samples with the CodeMirror filter editor.
  await page.goto("/#/logs/");
  await expect(page.getByText("csp-main.json").first()).toBeVisible();
  await page.goto(`/#/logs/${encodeURIComponent("csp-main.json")}/samples`);
  const editor = page.locator(".cm-editor").first();
  await expect(editor).toBeVisible();
  // CodeMirror's base theme, applied through an adopted stylesheet.
  await expect(editor).toHaveCSS("display", "flex");

  // Messages: data: image, audio and video, and MathJax.
  await page.goto(sampleUrl("csp-main.json", "media", "messages"));
  const image = page.locator('img[src^="data:image/png"]').first();
  await expect(image).toBeVisible();
  expect(
    await image.evaluate((element: HTMLImageElement) => element.naturalWidth)
  ).toBe(16);
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

  const container = page.locator("mjx-container").first();
  await expect(container.locator("svg").first()).toBeVisible();
  await expect(container).toHaveCSS("position", "relative");
  await expect(container.locator("mjx-assistive-mml").first()).toHaveCSS(
    "clip",
    "rect(1px, 1px, 1px, 1px)"
  );
  await expect(container.locator("svg a").first()).toHaveCSS(
    "fill",
    "rgb(0, 0, 255)"
  );
  await expect(page.locator("mjx-container[display='true']")).toHaveCSS(
    "display",
    "block"
  );

  // Transcript: the human-baseline terminal (asciinema, WebAssembly).
  await page.goto(sampleUrl("csp-main.json", "terminal", "transcript"));
  await page.getByText("Terminal Session").click();
  await expect(page.locator(".ap-player").first()).toBeVisible();
  await expect(page.locator(".ap-player").first()).toContainText(kTerminalText);

  // The log response is past the JSON parser's worker threshold, so the
  // bundled worker started from the build's own origin and did the parse.
  // (A same-origin worker script gets no policy from this page's meta tag,
  // so this proves the worker starts under `worker-src 'self'`, not that
  // its code avoids eval: that part is grep-checked in the bundle.)
  expect(await policy.workerMessages()).toContain("parse");
  expect(policy.workers.length).toBeGreaterThan(0);
  for (const url of policy.workers) {
    expect(url).toMatch(new RegExp(`^${baseURL}/assets/json-parse\\.worker`));
  }

  expect(await policy.violations()).toEqual([]);
  expect(policy.offOrigin()).toEqual([]);
});

for (const preference of ["light", "dark", "system"] as const) {
  test(`the theme bootstrap applies "${preference}" before the body parses`, async ({
    page,
    network,
    baseURL,
  }) => {
    serveLog(network, mainLog, "csp-main.json");
    await page.emulateMedia({ colorScheme: "dark" });
    const policy = await watchPolicy(page, baseURL);
    await page.addInitScript((themePreference) => {
      localStorage.setItem(
        "inspect-view-user-settings",
        JSON.stringify({ state: { themePreference }, version: 0 })
      );
      // The theme at the moment <body> is inserted, before any module
      // script or first paint: what the inline bootstrap alone decided.
      // colorScheme too, since the static HTML already says "light".
      new MutationObserver((_records, observer) => {
        if (!document.querySelector("body")) return;
        observer.disconnect();
        const root = document.documentElement;
        root.dataset.themeAtBody = `${root.dataset.bsTheme}/${root.style.colorScheme}`;
      }).observe(document, { childList: true, subtree: true });
    }, preference);

    await page.goto("/#/logs/");
    await expect(page.getByText("csp-main.json").first()).toBeVisible();
    const expected = preference === "light" ? "light" : "dark";
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-at-body",
      `${expected}/${expected}`
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-bs-theme",
      expected
    );
    expect(await policy.violations()).toEqual([]);
  });
}

// Known gap, pinned so it flips when fixed: filtrex compiles each filter
// with `new Function`, which the policy blocks, so the filter never applies.
// The evaluator on brandly/filtrex-evaluator replaces it; then assert the
// filter narrows the list with no violation instead.
test("the policy blocks filtrex's eval in the sample filter", async ({
  page,
  network,
  baseURL,
}) => {
  serveLog(network, mainLog, "csp-main.json");
  const policy = await watchPolicy(page, baseURL);
  await page.goto(`/#/logs/${encodeURIComponent("csp-main.json")}/samples`);
  await expect(page.getByText("terminal", { exact: true })).toBeVisible();
  await page.locator(".cm-content").first().click();
  await page.keyboard.type('id == "media"');
  await expect
    .poll(async () =>
      (await policy.violations()).some((v) => v.startsWith("script-src eval"))
    )
    .toBe(true);
  await expect(page.getByText("terminal", { exact: true })).toBeVisible();
});

test.describe("rendering canary", () => {
  const openCanary = async (page: Page) => {
    await page.goto(sampleUrl("csp-canary.json", "canary", "messages"));
    // Elements, not text: the escaped source would contain the same words
    // if the breakout stopped producing markup.
    // They land inside MathJax's clipped SVG, so exist rather than show.
    await expect(page.locator("a", { hasText: /^js link$/ })).toHaveCount(1);
    await expect(page.locator("div", { hasText: /^css url$/ })).toHaveCount(1);
  };

  test("injected vectors never reach the probe host", async ({
    page,
    network,
    baseURL,
  }) => {
    serveLog(network, canaryLog, "csp-canary.json");
    const probed: string[] = [];
    await page.route(`**://${kProbeHost}/**`, (route) => {
      probed.push(route.request().url());
      return route.fulfill({ status: 204 });
    });
    const policy = await watchPolicy(page, baseURL);
    await openCanary(page);
    await page.locator("a", { hasText: /^js link$/ }).dispatchEvent("click");
    await page
      .locator("div", { hasText: /^css url$/ })
      .dispatchEvent("mouseover");
    await page.waitForTimeout(500);

    expect(probed).toEqual([]);
    expect(policy.offOrigin()).toEqual([]);
  });

  // Known gap, pinned so it flips when fixed: the sanitizer still admits
  // `<table background>` (fixed separately), so the policy has to block,
  // and report, that one fetch. Once the sanitizer strips it, assert no
  // report at all.
  test("the only CSP report is the blocked <table background> fetch", async ({
    page,
    network,
    baseURL,
  }) => {
    serveLog(network, canaryLog, "csp-canary.json");
    const policy = await watchPolicy(page, baseURL);
    await openCanary(page);
    await expect(
      page.locator(`table[background*="${kProbeHost}"]`)
    ).toHaveCount(1);
    await page.waitForTimeout(500);
    const violations = await policy.violations();
    expect(
      violations.some((v) =>
        v.startsWith(`img-src https://${kProbeHost}/table`)
      )
    ).toBe(true);
    for (const violation of violations) {
      expect(violation).toContain(`${kProbeHost}/table`);
    }
  });
});
