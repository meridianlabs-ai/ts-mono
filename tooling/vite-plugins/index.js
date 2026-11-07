/**
 * Shared Vite plugins for ts-mono apps.
 */

import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { relative, resolve as resolvePath } from "path";

import { build as esbuildBuild, context as esbuildContext } from "esbuild";

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Proxy `configure` hook that rewrites loopback `Origin` headers to the
 * proxy target.
 *
 * `changeOrigin` only rewrites Host, not Origin, so mutating requests reach
 * the proxied server with the dev server's origin and its CSRF check rejects
 * them with 403 "Forbidden browser origin". Rewrite only loopback origins so
 * genuinely cross-site writes still fail that check.
 *
 * @param {string} target the proxy target url, e.g. "http://127.0.0.1:7575"
 * @returns {import("vite").ProxyOptions["configure"]}
 */
export function rewriteLoopbackOrigin(target) {
  return (proxy) => {
    proxy.on("proxyReq", (proxyReq, req) => {
      const origin = req.headers.origin;
      if (origin && LOOPBACK_ORIGIN.test(origin)) {
        proxyReq.setHeader("origin", target);
      }
    });
  };
}

/**
 * Inline a theme-bootstrap module into index.html as a synchronous,
 * render-blocking <script>.
 *
 * The bootstrap must run before the app's CSS link and module bundle so
 * `data-bs-theme` / the `vscode-*` body class are set before first paint
 * (otherwise the page flashes light then repaints dark). esbuild bundles
 * the entry to a self-contained IIFE so it has no import dependency on the
 * async module graph.
 *
 * @param {string} entry absolute path to the bootstrap entry module
 * @param {string} [placeholder] HTML comment to replace
 * @returns {import("vite").Plugin}
 */
export function inlineThemeBootstrap(
  entry,
  placeholder = "<!-- THEME_BOOTSTRAP -->"
) {
  // One reused esbuild context so the dev server's per-reload HTML transform
  // is an incremental rebuild (~ms) instead of a cold bundle (~50-200ms each).
  // The context tracks the entry's whole dependency graph, so edits to the
  // bootstrap module (or anything it imports) are still picked up.
  let ctxPromise;
  const getCtx = () => {
    // Don't cache a rejected context (e.g. entry not yet generated on first
    // request) — that would wedge every later reload until a server restart.
    ctxPromise ??= esbuildContext({
      entryPoints: [entry],
      bundle: true,
      format: "iife",
      target: "es2020",
      minify: true,
      write: false,
    }).catch((err) => {
      ctxPromise = undefined;
      throw err;
    });
    return ctxPromise;
  };

  return {
    name: "inline-theme-bootstrap",
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        if (!html.includes(placeholder)) {
          throw new Error(
            `inlineThemeBootstrap: placeholder ${placeholder} not found in index.html`
          );
        }
        const ctx = await getCtx();
        const result = await ctx.rebuild();
        const code = result.outputFiles[0].text.trim();
        return html.replace(placeholder, `<script>${code}</script>`);
      },
    },
    async closeBundle() {
      if (ctxPromise) {
        const ctx = await ctxPromise;
        ctxPromise = undefined;
        await ctx.dispose();
      }
    },
  };
}

const WORKER_URL_QUERY = "?worker&url";
const INLINE_WORKER_PREFIX = "\0inline-worker-url:";

/**
 * Library builds only: resolve `?worker&url` imports to a Blob URL of the
 * bundled worker instead of an emitted asset.
 *
 * Vite's library mode emits a worker asset with a root-absolute URL
 * ("/assets/…"), which an embedding app does not serve, and bundlers
 * handle `new URL(…, import.meta.url)` inside dependencies unevenly. An
 * inline Blob keeps the package self-contained; embedders need
 * `worker-src blob:`, but no eval.
 *
 * @returns {import("vite").Plugin}
 */
export function inlineWorkerUrls() {
  return {
    name: "inline-worker-urls",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(WORKER_URL_QUERY)) return null;
      const resolved = await this.resolve(
        source.slice(0, -WORKER_URL_QUERY.length),
        importer,
        { skipSelf: true }
      );
      // Relative, so the module id (echoed in output comments) carries no
      // local absolute path into the published package.
      return resolved
        ? `${INLINE_WORKER_PREFIX}${relative(process.cwd(), resolved.id)}`
        : null;
    },
    async load(id) {
      if (!id.startsWith(INLINE_WORKER_PREFIX)) return null;
      const entry = resolvePath(id.slice(INLINE_WORKER_PREFIX.length));
      const result = await esbuildBuild({
        entryPoints: [entry],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: true,
        write: false,
        metafile: true,
      });
      for (const input of Object.keys(result.metafile.inputs)) {
        this.addWatchFile(resolvePath(input));
      }
      const code = JSON.stringify(result.outputFiles[0].text);
      // Guarded so importing the package cannot throw where Blob URLs don't
      // exist (e.g. an embedder's jsdom tests); starting a worker there
      // fails later, as it would anyway.
      return `export default typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([${code}], { type: "text/javascript" })) : "";`;
    },
  };
}

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const SCRIPT_SRC = /(?:^|\s)src\s*=/i;
// A script with any other type is a data block (e.g. the log_dir_context
// JSON `inspect view bundle` adds), which CSP does not govern.
const SCRIPT_TYPE = /(?:^|\s)type\s*=\s*["']?([^"'\s>]+)/i;
const EXECUTABLE_TYPES = new Set([
  "module",
  "text/javascript",
  "application/javascript",
]);

// The hosts that deliver the policy (inspect_ai's _view/_csp.py, the VS Code
// extension's webview-csp.ts) reject these; fail the build instead of them.
const HOST_OWNED_DIRECTIVES = new Set(["frame-ancestors"]);
// Hosts translate these by name (the VS Code extension adds its nonce to
// script-src and blob: to worker-src), so a policy that relied on a fallback
// to default-src or script-src would build and pass e2e, then break there.
const REQUIRED_DIRECTIVES = ["default-src", "script-src", "worker-src"];
const TOKEN = /^[\x21-\x7e]+$/;

const validateDirectives = (directives) => {
  for (const name of REQUIRED_DIRECTIVES) {
    if (!(name in directives)) {
      throw new Error(`contentSecurityPolicy: ${name} must be set explicitly`);
    }
  }
  for (const [name, sources] of Object.entries(directives)) {
    if (HOST_OWNED_DIRECTIVES.has(name.toLowerCase())) {
      throw new Error(`contentSecurityPolicy: ${name} is set by each host`);
    }
    for (const token of [name, ...sources]) {
      if (!TOKEN.test(token) || /[;,]/.test(token)) {
        throw new Error(
          `contentSecurityPolicy: ${JSON.stringify(token)} in ${name} can't go in a header`
        );
      }
    }
  }
};

// Matches the calls `'unsafe-eval'` governs: `Function(` with or without
// `new`, `eval(`, indirect `(0, eval)(`, and `eval` called off a global.
// Worker code can't be checked in the browser (the page doesn't see a
// worker's violations, and a bundle's workers run with no policy), so the
// build checks every shipped script. `Function("return this")()` is
// allowed: bundled libraries use it as a global-object fallback that
// `globalThis` short-circuits. A match right after a quote or backtick is
// string text (wasm-bindgen's debug formatter writes `Function(${name})`).
const EVALS_CODE = new RegExp(
  [
    String.raw`(?<![.\w$"'\x60])Function\s*\((?!\s*(["'\x60])return this\1\s*\))`,
    String.raw`(?<![.\w$"'\x60])eval\s*\)?\s*\(`,
    String.raw`\b(?:globalThis|window|self)\.eval\s*\(`,
  ].join("|")
);

const sourceText = (source) =>
  typeof source === "string" ? source : new TextDecoder().decode(source);

/** A module id as `evalAllowedIn` and errors name it: its path inside
 *  node_modules, or else relative to the Vite root. */
const moduleName = (id, root) => {
  const path = id.replace(/\\/g, "/");
  const inPackage = path.lastIndexOf("/node_modules/");
  return inPackage >= 0
    ? path.slice(inPackage + "/node_modules/".length)
    : relative(root, id).replace(/\\/g, "/");
};

const evalSiteCount = (code) =>
  [...code.matchAll(new RegExp(EVALS_CODE.source, "g"))].length;

/**
 * Throw if an emitted script contains code a policy without `'unsafe-eval'`
 * would block. Each emitted chunk is checked whole, as minified, banners and
 * all. An `evalAllowedIn` entry (a path inside node_modules, e.g.
 * "arquero/src/expression/compile.js") lets that module's own eval sites
 * through: a chunk passes only if it has no more sites than its allowed
 * modules account for, and no other module has any. Worker scripts are
 * emitted as assets and never exempted: the page can't see a worker's
 * violations. An entry whose module no longer evaluates code fails too, so
 * the list can't outlive what it was for.
 */
const rejectEval = (bundle, evalAllowedIn, root) => {
  const offenders = [];
  const usedAllowances = new Set();
  for (const output of Object.values(bundle)) {
    if (!output.fileName.endsWith(".js")) continue;
    const code =
      output.type === "chunk" ? output.code : sourceText(output.source);
    const sites = evalSiteCount(code);
    const modules =
      output.type === "chunk"
        ? Object.entries(output.modules).filter(([, m]) => m.code !== null)
        : [];
    let allowedSites = 0;
    const disallowed = [];
    for (const [id, module] of modules) {
      const moduleSites = evalSiteCount(module.code);
      if (moduleSites === 0) continue;
      const name = moduleName(id, root);
      if (evalAllowedIn.includes(name)) {
        allowedSites += moduleSites;
        usedAllowances.add(name);
      } else {
        disallowed.push(`${output.fileName} (${name})`);
      }
    }
    if (disallowed.length > 0) {
      offenders.push(...disallowed);
    } else if (sites > allowedSites) {
      offenders.push(output.fileName);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `contentSecurityPolicy: script-src has no 'unsafe-eval', but these scripts evaluate code: ${offenders.join(", ")}`
    );
  }
  const unused = evalAllowedIn.filter((name) => !usedAllowances.has(name));
  if (unused.length > 0) {
    throw new Error(
      `contentSecurityPolicy: evalAllowedIn lists modules that no longer evaluate code: ${unused.join(", ")}`
    );
  }
};

/**
 * The Content-Security-Policy both viewers (inspect, scout) build with. They
 * render untrusted content, and this is the second layer behind the
 * sanitizer. 'wasm-unsafe-eval' is for the asciinema player's WebAssembly,
 * and inline style attributes carry MathJax's per-glyph layout. Hosts rely
 * on worker-src staying explicit (the VS Code extension adds blob: to it for
 * cross-origin workers) and on an empty list meaning a directive without
 * sources.
 */
export const VIEWER_CSP_DIRECTIVES = Object.freeze({
  "default-src": ["'none'"],
  "script-src": ["'self'", "'wasm-unsafe-eval'"],
  "worker-src": ["'self'"],
  "style-src-elem": ["'self'"],
  "style-src-attr": ["'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "media-src": ["data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "frame-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
});

/** File the build writes next to index.html; hosts deliver the policy from it. */
export const CSP_FILE = "content-security-policy.json";

/** The header / meta value for a policy file's directives, in file order. */
export const policyString = (directives) =>
  Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");

/**
 * Build: write the viewer's Content-Security-Policy to `CSP_FILE` in the
 * output directory, with a `'sha256-…'` source added to script-src (after
 * its first source) for every inline script in the emitted index.html, so
 * the hashes always match what ships. Unless script-src allows
 * `'unsafe-eval'`, the build also fails, before writing anything, if any
 * emitted script evaluates code (see `EVALS_CODE`).
 *
 * The policy is data rather than a <meta> in index.html because each host
 * delivers it its own way: `inspect view` as a header, `inspect view bundle`
 * as a meta tag, and the VS Code extension translated for its webview
 * origin. A meta baked into index.html would also bind hosts that can't
 * strip it, such as older VS Code extensions.
 *
 * Preview: `vite preview` sends the built policy as a header on every
 * response, as `inspect view` does. The dev server gets no policy; its HMR
 * client and React preamble are inline and differ per session.
 *
 * @param {Record<string, string[]>} directives the policy, in order
 * @param {{ evalAllowedIn?: string[] }} [options] `evalAllowedIn`: modules
 *   (paths inside node_modules, or relative to the app root) whose own eval
 *   sites the check allows; eval elsewhere in their chunk still fails, and so
 *   does an entry with no eval left. Only for code the app can be shown never
 *   to run (its e2e under the policy, and `@no-unsafe-eval` unit tests, cover
 *   what it does run).
 * @returns {import("vite").Plugin}
 */
export function contentSecurityPolicy(directives, { evalAllowedIn = [] } = {}) {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "content-security-policy",
    apply: (_config, env) => env.command === "build" || env.isPreview === true,
    configResolved(config) {
      root = config.root;
      outDir = resolvePath(config.root, config.build.outDir);
    },
    buildStart() {
      validateDirectives(directives);
    },
    generateBundle(_options, bundle) {
      if (!directives["script-src"]?.includes("'unsafe-eval'")) {
        rejectEval(bundle, evalAllowedIn, root);
      }
    },
    writeBundle(options) {
      const dir = options.dir ?? outDir;
      const html = readFileSync(resolvePath(dir, "index.html"), "utf8");
      const hashes = [];
      for (const [, attributes, code] of html.matchAll(INLINE_SCRIPT)) {
        if (SCRIPT_SRC.test(attributes)) continue;
        const type = SCRIPT_TYPE.exec(attributes)?.[1]?.toLowerCase();
        if (type && !EXECUTABLE_TYPES.has(type)) continue;
        // The browser hashes the text after HTML parsing turns CRLF and CR
        // into LF; a Windows checkout's index.html can carry CRLF.
        const digest = createHash("sha256")
          .update(code.replace(/\r\n?/g, "\n"))
          .digest("base64");
        hashes.push(`'sha256-${digest}'`);
      }
      const withHashes = Object.fromEntries(
        Object.entries(directives).map(([name, sources]) => [
          name,
          name === "script-src"
            ? [...sources.slice(0, 1), ...hashes, ...sources.slice(1)]
            : sources,
        ])
      );
      writeFileSync(
        resolvePath(dir, CSP_FILE),
        `${JSON.stringify({ version: 1, directives: withHashes }, null, 2)}\n`
      );
    },
    configurePreviewServer(server) {
      const file = resolvePath(outDir, CSP_FILE);
      if (!existsSync(file)) {
        throw new Error(
          `${outDir} has no ${CSP_FILE}; rebuild before previewing`
        );
      }
      server.middlewares.use((_req, res, next) => {
        const { directives: built } = JSON.parse(readFileSync(file, "utf8"));
        res.setHeader("Content-Security-Policy", policyString(built));
        next();
      });
    },
  };
}
