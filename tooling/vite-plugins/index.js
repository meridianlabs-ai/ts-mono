/**
 * Shared Vite plugins for ts-mono apps.
 */

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
      return `export default URL.createObjectURL(new Blob([${code}], { type: "text/javascript" }));`;
    },
  };
}
