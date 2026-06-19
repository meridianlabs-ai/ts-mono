/**
 * Shared Vite plugins for ts-mono apps.
 */

import { context as esbuildContext } from "esbuild";

/**
 * Inline a theme-bootstrap module into index.html as a synchronous,
 * render-blocking <script>.
 *
 * The bootstrap must run before the app's CSS link and module bundle so
 * `data-theme` / the `vscode-*` body class are set before first paint
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
