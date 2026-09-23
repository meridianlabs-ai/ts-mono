import { build, type Plugin } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  type TestContext,
} from "vitest";

// json-worker.test.ts covers only the <50KB main-thread paths; the worker
// itself (json-parse.worker.ts) needs a real Web Worker, which Vitest's node
// environment can never run. This suite bundles the bench harness with
// esbuild and drives real Chromium (real Web Workers) via playwright-core so
// a syntax, serialization, or lifecycle regression inside the worker fails
// normal CI: large string input, large byte input (transfer), the reparse
// path for node-dense payloads, the non-finite repair fallback, JSON5 inside
// the worker, worker error propagation, and both ways workerLauncher starts
// the worker: directly from a same-origin script under a strict CSP, and
// from a Blob when the script is cross-origin (VS Code webviews). Correctness checks
// (structural probes + exact non-finite value counts) come from
// bench/browser-entry.ts.

const TEST_TIMEOUT = 120_000;

// Mirrors of json-worker.ts internals (not exported): kWorkerMinSize and
// kReparseThresholdChars. Tests assert payload sizes against these so a
// silently-undersized payload can't fake worker-path coverage.
const WORKER_MIN_CHARS = 50_000;
const REPARSE_THRESHOLD_CHARS = 10_000_000;

interface CaseRun {
  verified: boolean;
  verifyDetail?: string;
}

interface PayloadSize {
  chars: number;
  bytes: number;
}

declare global {
  interface Window {
    JsonWorkerBench: {
      warmupPool: () => Promise<void>;
      generate: (kind: string, targetBytes: number) => PayloadSize;
      setPayload: (text: string) => PayloadSize;
      runCase: (
        api: string,
        iterations: number,
        innerReps: number
      ) => Promise<CaseRun>;
      tryParse: (
        api: string,
        text: string
      ) => Promise<{ ok: boolean; error?: string }>;
      releasePayload: () => void;
    };
  }
}

// The CI test job installs no playwright-managed browsers, so fall back to
// the runner's system Chrome/Chromium. chromiumSandbox: false lets the
// system binary launch inside containers and CI sandboxes.
const launchBrowser = async (): Promise<Browser | null> => {
  const base = { headless: true, chromiumSandbox: false };
  const attempts = [
    () => chromium.launch(base),
    () => chromium.launch({ ...base, channel: "chrome" }),
    ...[
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/opt/pw-browsers/chromium",
    ].map((path) => () => chromium.launch({ ...base, executablePath: path })),
  ];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch {
      // try the next candidate
    }
  }
  return null;
};

const kPageOrigin = "http://json-worker.test";
// A second origin serving the same scripts, the way a VS Code webview loads
// the viewer's assets from a CDN origin.
const kAssetOrigin = "http://assets.json-worker.test";

// The CSP the viewer ships, minus what this bare page doesn't load.
const kStrictPolicy =
  "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'";

// Resolves `?worker&url` imports the way the app build does: the worker is
// bundled to its own classic script, served next to the harness, and the
// import yields its URL relative to the script that imported it.
const kWorkerUrlQuery = "?worker&url";

const workerUrlPlugin = (workers: Map<string, string>): Plugin => ({
  name: "worker-url",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\?worker&url$/ }, (args) => ({
      path: decodeURIComponent(
        new URL(
          `${args.path.slice(0, -kWorkerUrlQuery.length)}.ts`,
          `file://${args.resolveDir}/`
        ).pathname
      ),
      namespace: "worker-url",
    }));
    pluginBuild.onLoad(
      { filter: /.*/, namespace: "worker-url" },
      async (args) => {
        const name = `${args.path.split("/").pop()?.replace(/\.ts$/, "")}.js`;
        const worker = await build({
          entryPoints: [args.path],
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          target: "es2022",
        });
        workers.set(`/${name}`, worker.outputFiles[0]!.text);
        return {
          contents: `export default new URL(${JSON.stringify(name)}, document.currentScript.src).href;`,
          loader: "js",
        };
      }
    );
  },
});

let browser: Browser | null = null;
let page: Page | null = null;
let workerUrls: string[] = [];
let crossOriginPage: Page | null = null;
let crossOriginWorkerUrls: string[] = [];

// Skip (rather than fail) where no Chromium exists at all — e.g. a bare
// local checkout. CI runners always provide one, so coverage there is real.
const requirePage = (ctx: TestContext): Page => {
  if (!page) {
    ctx.skip("no Chromium/Chrome available in this environment");
  }
  return page;
};

const runVerified = async (p: Page, api: string): Promise<void> => {
  const result = await p.evaluate(
    (a) => window.JsonWorkerBench.runCase(a, 1, 1),
    api
  );
  expect(result.verified, result.verifyDetail).toBe(true);
};

// Runs in the page: builds a node-dense payload (rows of small numbers, ~3
// separators per ~15 chars) large enough to cross the worker's reparse
// threshold, optionally seeding bare non-finite tokens every nanEvery rows.
const buildDensePayload = (opts: {
  minChars: number;
  nanEvery: number;
}): PayloadSize => {
  const tokens = ["NaN", "Infinity", "-Infinity"];
  const rows: string[] = [];
  let chars = 2;
  for (let i = 0; chars < opts.minChars; i++) {
    const third =
      opts.nanEvery > 0 && i % opts.nanEvery === 0
        ? tokens[(i / opts.nanEvery) % 3]!
        : String(i % 97);
    const row = `[${i},${i + 1},${third}]`;
    rows.push(row);
    chars += row.length + 1;
  }
  return window.JsonWorkerBench.setPayload(`[${rows.join(",")}]`);
};

const openHarness = async (
  b: Browser,
  scriptOrigin: string,
  bundleJs: string,
  workers: Map<string, string>
): Promise<{ page: Page; workerUrls: string[] }> => {
  const p = await b.newPage();
  const urls: string[] = [];
  p.setDefaultTimeout(60_000);
  p.on("console", (msg) => {
    if (msg.type() === "error") console.error("[page]", msg.text());
  });
  p.on("pageerror", (err) => console.error("[pageerror]", err.message));
  p.on("worker", (worker) => urls.push(worker.url()));

  // Serve the harness from routed fake origins — no HTTP server needed
  await p.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const script =
      url.pathname === "/harness.js" ? bundleJs : workers.get(url.pathname);
    if (script !== undefined) {
      return route.fulfill({
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": kPageOrigin },
        body: script,
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body:
        "<!doctype html>" +
        (scriptOrigin === kPageOrigin
          ? `<meta http-equiv="Content-Security-Policy" content="${kStrictPolicy}">`
          : "") +
        `<script src='${scriptOrigin}/harness.js'></script>`,
    });
  });
  await p.goto(`${kPageOrigin}/`);
  await p.waitForFunction(() => !!window.JsonWorkerBench);
  await p.evaluate(() => window.JsonWorkerBench.warmupPool());
  return { page: p, workerUrls: urls };
};

beforeAll(async () => {
  const benchDir = decodeURIComponent(
    new URL("../bench/", import.meta.url).pathname
  );
  const workers = new Map<string, string>();
  const bundle = await build({
    entryPoints: [`${benchDir}browser-entry.ts`],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    absWorkingDir: benchDir,
    plugins: [workerUrlPlugin(workers)],
  });
  const bundleJs = bundle.outputFiles[0]!.text;

  browser = await launchBrowser();
  if (!browser) {
    console.warn(
      "json-worker.browser.test: no Chromium/Chrome found — worker-path " +
        "tests will be skipped"
    );
    return;
  }

  ({ page, workerUrls } = await openHarness(
    browser,
    kPageOrigin,
    bundleJs,
    workers
  ));
  ({ page: crossOriginPage, workerUrls: crossOriginWorkerUrls } =
    await openHarness(browser, kAssetOrigin, bundleJs, workers));
}, TEST_TIMEOUT);

afterAll(async () => {
  await browser?.close();
});

describe("json-worker in real Chromium (worker paths)", () => {
  test(
    "a same-origin worker script starts directly under a strict CSP",
    (ctx) => {
      requirePage(ctx);
      expect(workerUrls.length).toBeGreaterThan(0);
      for (const url of workerUrls) {
        expect(url).toBe(`${kPageOrigin}/json-parse.worker.js`);
      }
    },
    TEST_TIMEOUT
  );

  test(
    "a cross-origin worker script starts from a Blob and parses",
    async (ctx) => {
      requirePage(ctx);
      const p = crossOriginPage;
      if (!p) throw new Error("cross-origin harness did not open");
      expect(crossOriginWorkerUrls.length).toBeGreaterThan(0);
      for (const url of crossOriginWorkerUrls) {
        expect(url).toMatch(/^blob:http:\/\/json-worker\.test\//);
      }
      await p.evaluate(() => window.JsonWorkerBench.generate("flat", 200_000));
      await runVerified(p, "asyncJsonParse");
      await p.evaluate(() => window.JsonWorkerBench.releasePayload());
    },
    TEST_TIMEOUT
  );

  test(
    "large string and large bytes parse via the worker (clone path)",
    async (ctx) => {
      const p = requirePage(ctx);
      const size = await p.evaluate(() =>
        window.JsonWorkerBench.generate("flat", 1_000_000)
      );
      expect(size.chars).toBeGreaterThan(WORKER_MIN_CHARS);
      await runVerified(p, "asyncJsonParse");
      await runVerified(p, "asyncJsonParseBytes");
      await p.evaluate(() => window.JsonWorkerBench.releasePayload());
    },
    TEST_TIMEOUT
  );

  test(
    "node-dense payload over the reparse threshold survives both routes",
    async (ctx) => {
      const p = requirePage(ctx);
      const size = await p.evaluate(buildDensePayload, {
        minChars: 10_500_000,
        nanEvery: 0,
      });
      expect(size.chars).toBeGreaterThan(REPARSE_THRESHOLD_CHARS);
      // string requests keep their text on the main thread; byte requests
      // exercise the sourceText ship-back branch of the reparse response
      await runVerified(p, "asyncJsonParse");
      await runVerified(p, "asyncJsonParseBytes");
      await p.evaluate(() => window.JsonWorkerBench.releasePayload());
    },
    TEST_TIMEOUT
  );

  test(
    "bare non-finite tokens repair in the worker (fixup + clone)",
    async (ctx) => {
      const p = requirePage(ctx);
      // generator seeds NaN/Infinity/-Infinity values plus in-string decoys;
      // verification compares exact non-finite counts against the reference
      const size = await p.evaluate(() =>
        window.JsonWorkerBench.generate("nonfinite", 1_000_000)
      );
      expect(size.chars).toBeGreaterThan(WORKER_MIN_CHARS);
      await runVerified(p, "asyncJsonParse");
      await runVerified(p, "asyncJsonParseBytes");
      await p.evaluate(() => window.JsonWorkerBench.releasePayload());
    },
    TEST_TIMEOUT
  );

  test(
    "non-finite repair on a dense payload (reparse + sentinel paths)",
    async (ctx) => {
      const p = requirePage(ctx);
      const size = await p.evaluate(buildDensePayload, {
        minChars: 10_500_000,
        nanEvery: 500,
      });
      expect(size.chars).toBeGreaterThan(REPARSE_THRESHOLD_CHARS);
      await runVerified(p, "asyncJsonParse");
      await p.evaluate(() => window.JsonWorkerBench.releasePayload());
    },
    TEST_TIMEOUT
  );

  test(
    "real JSON5 syntax falls back to JSON5.parse inside the worker",
    async (ctx) => {
      const p = requirePage(ctx);
      // exercises JSON5 bundled into the worker script
      const size = await p.evaluate(() =>
        window.JsonWorkerBench.generate("json5", 100_000)
      );
      expect(size.chars).toBeGreaterThan(WORKER_MIN_CHARS);
      await runVerified(p, "asyncJsonParse");
      await runVerified(p, "asyncJsonParseBytes");
      await p.evaluate(() => window.JsonWorkerBench.releasePayload());
    },
    TEST_TIMEOUT
  );

  test(
    "invalid large input rejects through the worker",
    async (ctx) => {
      const p = requirePage(ctx);
      const results = await p.evaluate(async () => {
        const bad = `[${"1,".repeat(30_000)}oops]`;
        return {
          chars: bad.length,
          text: await window.JsonWorkerBench.tryParse("asyncJsonParse", bad),
          bytes: await window.JsonWorkerBench.tryParse(
            "asyncJsonParseBytes",
            bad
          ),
        };
      });
      expect(results.chars).toBeGreaterThan(WORKER_MIN_CHARS);
      expect(results.text.ok).toBe(false);
      expect(results.text.error).toBeTruthy();
      expect(results.bytes.ok).toBe(false);
      expect(results.bytes.error).toBeTruthy();
    },
    TEST_TIMEOUT
  );
});
