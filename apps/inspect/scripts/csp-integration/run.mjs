// Check the viewer's CSP on every host that delivers it; see README.md.
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { CSP_FILE } from "../../../../tooling/vite-plugins/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const appDir = join(here, "..", "..");
const python = process.env.INSPECT_AI_PYTHON;
const vscodeDir = process.env.INSPECT_VSCODE_DIR;
if (!python) {
  console.error("Set INSPECT_AI_PYTHON to a python with inspect_ai installed.");
  process.exit(2);
}
const keepWork = process.env.CSP_WORK_DIR !== undefined;
const work = process.env.CSP_WORK_DIR ?? mkdtempSync(join(tmpdir(), "csp-"));
// CSP_DIST tests a prebuilt viewer (e.g. one with unmerged branches) instead
// of building this checkout.
const dist = process.env.CSP_DIST ?? join(work, "dist");
const logDir = join(work, "logs");
const bundleDir = join(work, "bundle");

// Every policy blocks this; each host must report it, which proves a policy
// is in force there (no violations is also what no policy looks like).
const kProbe = "https://csp-probe.invalid/probe.png";

const run = (cmd, args, opts = {}) => {
  try {
    execFileSync(cmd, args, { stdio: "pipe", ...opts });
  } catch (error) {
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${error.stderr ?? ""}`);
  }
};

const children = [];
const stopChildren = () => {
  for (const child of children) child.kill();
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChildren();
    process.exit(130);
  });
}

const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

const serve = async (cmd, args, url, opts = {}) => {
  // A leftover server on the port would be tested in place of this one.
  if (await up(url)) throw new Error(`something is already serving ${url}`);
  const child = spawn(cmd, args, {
    stdio: ["ignore", "ignore", "pipe"],
    ...opts,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  children.push(child);
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) break;
    if (await up(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `${cmd} ${args.join(" ")} did not come up at ${url}:\n${stderr}`
  );
};

// --- the checks --------------------------------------------------------------

const logs = () => {
  const files = readdirSync(logDir);
  return {
    zstd: files.find(
      (f) => f.endsWith(".eval") && !f.endsWith("-deflate.eval")
    ),
    deflate: files.find((f) => f.endsWith("-deflate.eval")),
    json: files.find((f) => f.endsWith(".json")),
  };
};

const sample = (file, tab) =>
  `#/logs/${encodeURIComponent(file)}/samples/sample/media/1/${tab}`;

// Drive one host; fail on any violation, off-origin request, rendering the
// policy would break, or read path that skipped its worker. `blocks` names
// directives this host's policy is known to block (the legacy VS Code run):
// those violations must appear, and what they stop isn't checked.
async function checkHost({ label, baseUrl, assetOrigin, setup, blocks = [] }) {
  const failures = [];
  const expect = (ok, what) => {
    if (!ok) failures.push(what);
  };
  const knownBlock = (text) =>
    text.includes(kProbe) || blocks.some((d) => text.includes(d));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
    });
    const origins = new Set(
      [new URL(baseUrl).origin, assetOrigin].filter(Boolean)
    );
    const offOrigin = [];
    const blocked = new Set();
    const errors = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["data:", "blob:"].includes(u.protocol) && !origins.has(u.origin))
        offOrigin.push(r.url());
    });
    page.on("requestfailed", (r) => {
      if (r.failure()?.errorText === "csp") blocked.add(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    page.on("console", (m) => {
      const text = m.text();
      const known =
        knownBlock(text) ||
        (blocks.includes("media-src") && /Loading media from/.test(text));
      if (/Content Security Policy/i.test(text) && !known)
        errors.push(text.slice(0, 200));
    });
    await page.addInitScript(() => {
      window.__violations = [];
      window.__posted = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.__violations.push(`${e.effectiveDirective} ${e.blockedURI}`)
      );
      const original = Reflect.get(Worker.prototype, "postMessage");
      Object.defineProperty(Worker.prototype, "postMessage", {
        value(message, ...rest) {
          window.__posted.push(
            [message?.type, message?.method].filter(Boolean).join(":")
          );
          return Reflect.apply(original, this, [message, ...rest]);
        },
      });
    });
    if (setup) await setup(page);

    // Worker requests over the whole run: a host may read a log earlier than
    // the page that shows it (e.g. while backfilling the list).
    const sentAll = new Set();
    const posted = async () => {
      const sent = await page.evaluate(() =>
        window.__posted.splice(0, window.__posted.length)
      );
      for (const kind of sent) sentAll.add(kind);
    };

    try {
      const { zstd, deflate, json } = logs();
      const checkMessages = async (file, worker) => {
        await page.goto(baseUrl + sample(file, "messages"));
        await page
          .locator("mjx-container svg")
          .first()
          .waitFor({ timeout: 30000 });
        const facts = await page.evaluate(async () => {
          const media = [...document.querySelectorAll("audio, video")];
          for (let i = 0; i < 40 && media.some((m) => m.readyState < 1); i++)
            await new Promise((r) => setTimeout(r, 250));
          const c = document.querySelector("mjx-container");
          const a = c?.querySelector("mjx-assistive-mml");
          const img = document.querySelector("img[src^='data:image/png']");
          return {
            media: media.map((m) => m.readyState),
            image: img?.naturalWidth ?? 0,
            position: c ? getComputedStyle(c).position : "",
            clip: a ? getComputedStyle(a).clip : "",
          };
        });
        if (!blocks.includes("media-src"))
          expect(
            facts.media.length === 2 && facts.media.every((s) => s >= 1),
            `${file}: audio/video loaded (${facts.media})`
          );
        expect(facts.image > 0, `${file}: data: image loaded`);
        expect(
          facts.position === "relative" &&
            facts.clip === "rect(1px, 1px, 1px, 1px)",
          `${file}: mathjax.css applied (${facts.position}, ${facts.clip})`
        );
        await posted();
        if (worker)
          expect(
            sentAll.has(worker),
            `${file}: read via the ${worker} worker (sent ${[...sentAll]})`
          );
      };

      await page.goto(baseUrl + "#/logs/");
      await page.getByText("csp_fixture").first().waitFor({ timeout: 30000 });
      await checkMessages(zstd, "decompress:zstd");
      await checkMessages(deflate, "decompress:deflate");
      await checkMessages(json, undefined);

      await page.goto(baseUrl + sample(zstd, "transcript"));
      await page
        .getByText("Terminal Session")
        .first()
        .click({ timeout: 30000 });
      await page.locator(".ap-player").first().waitFor({ timeout: 15000 });
      await page
        .waitForFunction(
          () =>
            document
              .querySelector(".ap-player")
              ?.textContent?.includes("csp-terminal-ok"),
          undefined,
          { timeout: 15000 }
        )
        .catch(() => expect(false, "asciinema terminal rendered"));

      await page.goto(baseUrl + `#/logs/${encodeURIComponent(zstd)}/samples`);
      const editor = page.locator(".cm-editor").first();
      await editor.waitFor({ timeout: 30000 });
      expect(
        (await editor.evaluate((e) => getComputedStyle(e).display)) === "flex",
        "CodeMirror styled"
      );
      await page
        .getByText("other", { exact: true })
        .first()
        .waitFor({ timeout: 15000 });
      await page.locator(".cm-content").first().click();
      await page.keyboard.type('id == "media"');
      const filtered =
        (await page
          .getByText("other", { exact: true })
          .waitFor({ state: "detached", timeout: 10000 })
          .then(
            () => true,
            () => false
          )) &&
        (await page
          .getByText("media", { exact: true })
          .first()
          .waitFor({ timeout: 5000 })
          .then(
            () => true,
            () => false
          ));
      expect(filtered, "sample filter kept only the matching sample");

      await posted();
      expect(
        sentAll.has("parse"),
        `large logs parsed in the JSON worker (sent ${[...sentAll]})`
      );

      await page.evaluate((src) => {
        const img = document.createElement("img");
        img.src = src;
        document.body.append(img);
      }, kProbe);
      await page
        .waitForFunction(
          (src) => window.__violations.some((v) => v.includes(src)),
          kProbe,
          { timeout: 5000 }
        )
        .catch(() =>
          expect(
            false,
            "a policy is in force (the probe image was not blocked)"
          )
        );
    } catch (error) {
      failures.push(`check aborted: ${String(error).split("\n")[0]}`);
    }

    const violations = await page.evaluate(() => window.__violations);
    for (const directive of blocks)
      expect(
        violations.some((v) => v.startsWith(directive)),
        `the legacy policy blocks ${directive}, as today (no violation seen)`
      );
    const unexpected = violations.filter((v) => !knownBlock(v));
    expect(
      unexpected.length === 0,
      `no CSP violations (${unexpected.slice(0, 5)})`
    );
    const leaked = offOrigin.filter((u) => !blocked.has(u));
    expect(
      leaked.length === 0,
      `no off-origin requests (${leaked.slice(0, 5)})`
    );
    expect(
      errors.length === 0,
      `no page or CSP errors (${errors.slice(0, 5)})`
    );
  } finally {
    await browser.close();
  }
  console.log(`${failures.length ? "FAIL" : "PASS"}  ${label}`);
  for (const f of failures) console.log(`      ✗ ${f}`);
  return failures.length === 0;
}

// Workers take their policy from their own response headers, which a meta
// policy doesn't supply (bundles), and the page can't observe violations
// inside them, so check statically that no shipped script evaluates code.
const scanForEval = () => {
  const assets = join(dist, "assets");
  const offenders = readdirSync(assets)
    .filter((f) => f.endsWith(".js"))
    .filter((f) =>
      /\bnew Function\s*\(|[^.\w$]eval\s*\(/.test(
        readFileSync(join(assets, f), "utf-8")
      )
    );
  const ok = offenders.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  no shipped script evaluates code`);
  if (!ok)
    console.log(`      ✗ new Function or eval in ${offenders.join(", ")}`);
  return ok;
};

// --- VS Code webview emulation ---------------------------------------------

const kWebview = "https://webview.vscode.test/index.html";
const kCdn = "https://file.vscode-cdn.test";
const kTypes = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

// The extension's own renderWebviewHtml, with a stub host for its proxy.
const vscodeSetup = (viewServer, legacy) => async (page) => {
  const ext = createRequire(join(vscodeDir, "package.json"));
  const { renderWebviewHtml } = ext("./out/core/webview-render.js");
  const { loadViewerCsp } = ext("./out/core/webview-csp.js");
  const policy = legacy ? { status: "absent" } : loadViewerCsp(dist);
  if (!legacy && policy.status !== "valid")
    throw new Error(
      `the extension can't load this dist's policy: ${JSON.stringify(policy)}`
    );
  const html = renderWebviewHtml({
    indexHtml: readFileSync(join(dist, "index.html"), "utf-8"),
    policy,
    cspSource: kCdn,
    nonce: `n${Math.random().toString(36).slice(2)}`,
    resourceUri: (path) =>
      `${kCdn}/${posix.normalize(path).replace(/^\/+/, "")}`,
    extensionVersion: "0.0.0-csp",
    extraHead: `<script id="inspect-host-capabilities" type="application/json">["http_request"]</script>`,
    packageName: "Inspect AI",
  });
  await page.route(`${kWebview}*`, (route) =>
    route.fulfill({ contentType: "text/html", body: html })
  );
  await page.route(`${kCdn}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = join(dist, path);
    return existsSync(file)
      ? route.fulfill({
          headers: {
            "content-type": kTypes[extname(path)] ?? "application/octet-stream",
            "access-control-allow-origin": "*",
          },
          body: readFileSync(file),
        })
      : route.fulfill({ status: 404, body: "" });
  });
  // The extension host's side of the `http_request` proxy, outside the page.
  await page.exposeFunction("__hostHttp", async (request) => {
    const response = await fetch(`${viewServer}${request.path}`, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const body = Buffer.from(await response.arrayBuffer()).toString("base64");
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body,
      bodyEncoding: "base64",
    };
  });
  await page.addInitScript(() => {
    let state;
    window.acquireVsCodeApi = () => ({
      getState: () => state,
      setState: (value) => {
        state = value;
      },
      postMessage: (message) => {
        if (message?.method !== "http_request") return;
        window.__hostHttp(message.params[0]).then((result) =>
          window.dispatchEvent(
            new MessageEvent("message", {
              data: { jsonrpc: "2.0", id: message.id, result },
            })
          )
        );
      },
    });
  });
};

// --- main --------------------------------------------------------------------

try {
  console.log(`work dir: ${work}`);
  if (!process.env.CSP_DIST) {
    run("pnpm", ["exec", "vite", "build", "--outDir", dist, "--emptyOutDir"], {
      cwd: appDir,
    });
  }
  if (!existsSync(join(dist, CSP_FILE)))
    throw new Error(`${dist} has no ${CSP_FILE}`);
  rmSync(logDir, { recursive: true, force: true });
  run(python, [join(here, "make_logs.py"), logDir]);

  const serverPort = Number(process.env.CSP_SERVER_PORT ?? 7690);
  const staticPort = Number(process.env.CSP_STATIC_PORT ?? 8690);
  const server = `http://localhost:${serverPort}`;
  await serve(
    python,
    [
      join(here, "serve_dist.py"),
      dist,
      "view",
      "start",
      "--log-dir",
      logDir,
      "--port",
      String(serverPort),
      "--display",
      "plain",
    ],
    `${server}/`
  );
  const header =
    (await fetch(`${server}/`)).headers.get("content-security-policy") ?? "";
  if (!header.includes("default-src 'none'"))
    throw new Error(`inspect view sent no viewer policy: ${header}`);

  run(python, [
    join(here, "serve_dist.py"),
    dist,
    "view",
    "bundle",
    "--log-dir",
    logDir,
    "--output-dir",
    bundleDir,
    "--overwrite",
  ]);
  const bundled = readFileSync(join(bundleDir, "index.html"), "utf-8");
  const meta = bundled.indexOf('http-equiv="Content-Security-Policy"');
  if (meta < 0 || meta > bundled.indexOf("<script"))
    throw new Error(
      "inspect view bundle wrote no policy meta ahead of the inline scripts"
    );
  await serve(
    python,
    ["-m", "http.server", String(staticPort)],
    `http://localhost:${staticPort}/`,
    { cwd: bundleDir }
  );

  const results = [
    scanForEval(),
    await checkHost({ label: "inspect view (header)", baseUrl: `${server}/` }),
    await checkHost({
      label: "inspect view bundle (meta)",
      baseUrl: `http://localhost:${staticPort}/`,
    }),
  ];
  if (vscodeDir) {
    results.push(
      await checkHost({
        label: "VS Code webview, viewer policy",
        baseUrl: kWebview,
        assetOrigin: kCdn,
        setup: vscodeSetup(server, false),
      })
    );
    // Today's extension policy has no media-src, so data: audio and video are
    // blocked there already; the viewer policy's media-src data: fixes that.
    results.push(
      await checkHost({
        label: "VS Code webview, legacy policy (older extension)",
        baseUrl: kWebview,
        assetOrigin: kCdn,
        setup: vscodeSetup(server, true),
        blocks: ["media-src"],
      })
    );
  } else {
    console.log("SKIP  VS Code webview (set INSPECT_VSCODE_DIR)");
  }
  process.exitCode = results.every(Boolean) ? 0 : 1;
} finally {
  stopChildren();
  if (!keepWork) rmSync(work, { recursive: true, force: true });
}
