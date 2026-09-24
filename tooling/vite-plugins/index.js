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
const TOKEN = /^[\x21-\x7e]+$/;

const validateDirectives = (directives) => {
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
 * the hashes always match what ships.
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
 * @returns {import("vite").Plugin}
 */
export function contentSecurityPolicy(directives) {
  let outDir = "dist";
  return {
    name: "content-security-policy",
    apply: (_config, env) => env.command === "build" || env.isPreview === true,
    configResolved(config) {
      outDir = resolvePath(config.root, config.build.outDir);
    },
    buildStart() {
      validateDirectives(directives);
    },
    writeBundle(options) {
      const dir = options.dir ?? outDir;
      const html = readFileSync(resolvePath(dir, "index.html"), "utf8");
      const hashes = [];
      for (const [, attributes, code] of html.matchAll(INLINE_SCRIPT)) {
        if (SCRIPT_SRC.test(attributes)) continue;
        const type = SCRIPT_TYPE.exec(attributes)?.[1]?.toLowerCase();
        if (type && !EXECUTABLE_TYPES.has(type)) continue;
        const digest = createHash("sha256").update(code).digest("base64");
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
