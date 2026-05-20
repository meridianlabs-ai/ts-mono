/**
 * Shared Vite plugins for ts-mono apps.
 *
 * esbuild is imported lazily inside the handler: importing this module must
 * not require esbuild (the library build pulls in vite.config but never
 * uses this plugin, and not every app has esbuild as a direct dep).
 */

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
  return {
    name: "inline-theme-bootstrap",
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        const { build: esbuild } = await import("esbuild");
        const result = await esbuild({
          entryPoints: [entry],
          bundle: true,
          format: "iife",
          target: "es2020",
          minify: true,
          write: false,
        });
        const code = result.outputFiles[0].text.trim();
        return html.replace(placeholder, `<script>${code}</script>`);
      },
    },
  };
}
