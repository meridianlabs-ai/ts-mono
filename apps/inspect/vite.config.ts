import { cpSync, rmSync } from "fs";
import { join, resolve } from "path";

import react from "@vitejs/plugin-react-swc";
import pc from "picocolors";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

import {
  findPythonRepoRoot,
  warnIfWatchingWithoutSubmodule,
} from "../../tooling/python-repo/index.js";
import {
  contentSecurityPolicy,
  inlineThemeBootstrap,
  inlineWorkerUrls,
  rewriteLoopbackOrigin,
} from "../../tooling/vite-plugins/index.js";

function copyToPythonRepo(): Plugin {
  let outDir = "dist";
  return {
    name: "copy-to-python-repo",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      // Only the real app build ships; the CSP e2e builds elsewhere.
      if (outDir !== "dist") return;
      const pythonRoot = findPythonRepoRoot("inspect_ai");
      if (!pythonRoot) return;
      const target = join(pythonRoot, "src/inspect_ai/_view/dist");
      rmSync(target, { recursive: true, force: true });
      cpSync("dist", target, { recursive: true });
      console.log(
        `${pc.cyan("[vite]")} ${pc.bold("Copied")} dist → ${pc.dim(target)}`
      );
    },
  };
}

const viewServerUrl = "http://127.0.0.1:7575";

// The viewer renders untrusted log content; this is the second layer behind
// the sanitizer (see SECURITY.md). Inline scripts are hashed at build time.
// 'wasm-unsafe-eval' is for the asciinema player's WebAssembly, and inline
// style attributes carry MathJax's per-glyph layout. e2e/csp.spec.ts pins
// this policy, so changing it means changing that test too.
const contentSecurityPolicyDirectives = {
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
};

export default defineConfig(({ mode }) => {
  const isLibrary = mode === "library";

  const baseConfig = {
    plugins: [
      react({
        // Rust React Compiler via SWC. The escape hatch is required — the
        // plugin has no first-class reactCompiler option yet. Needs
        // plugin-react-swc >= 4.2.0 (earlier versions kept production builds
        // on the non-SWC path even when options are mutated) and
        // @swc/core >= 1.16.0 (where jsc.transform.reactCompiler landed).
        useAtYourOwnRisk_mutateSwcOptions(options) {
          options.jsc ??= {};
          options.jsc.transform ??= {};
          options.jsc.transform.reactCompiler = true;
        },
      }),
    ],
    resolve: {
      dedupe: [
        "react",
        "react-dom",
        "@codemirror/state",
        "@codemirror/view",
        "@codemirror/language",
      ],
    },
    define: {
      __DEV_WATCH__: JSON.stringify(process.env.DEV_LOGGING === "true"),
      __LOGGING_FILTER__: JSON.stringify(
        process.env.DEV_LOGGING_NAMESPACES || "*"
      ),
      __VIEW_SERVER_API_URL__: JSON.stringify(
        process.env.VIEW_SERVER_API_URL || "/api"
      ),
    },
  };

  if (isLibrary) {
    // Library build configuration
    return {
      ...baseConfig,
      plugins: [
        ...baseConfig.plugins,
        inlineWorkerUrls(),
        dts({
          insertTypesEntry: true,
          exclude: ["**/*.test.ts", "**/*.test.tsx", "src/setupTests.ts"],
        }),
      ],
      build: {
        outDir: "lib",
        lib: {
          entry: resolve(import.meta.dirname, "src/index.ts"),
          name: "InspectAILogViewer",
          fileName: "index",
          formats: ["es"],
        },
        rollupOptions: {
          // Externalize as regex so `react/jsx-runtime`, `react-dom/client`,
          // etc. are also externalized. Without this, Rolldown bundles the
          // CJS versions and emits runtime `__require("react")` calls that
          // throw in browsers.
          //
          // mathjax is heavy and registers globals; keep it external so the
          // consumer installs/dedupes it once instead of each viewer
          // shipping its own copy.
          //
          // use-sync-external-store (via @tanstack/react-store) is CJS-only
          // and `require`s react internally; bundling it alongside external
          // react leaves a runtime `__require("react")` that throws in
          // browsers. Externalize it (declared in dependencies) so the
          // consumer's bundler does the CJS interop.
          external: (id: string) =>
            /^(react|react-dom|use-sync-external-store)(\/|$)/.test(id) ||
            id === "mathjax-full" ||
            id.startsWith("mathjax-full/") ||
            id === "markdown-it-mathjax3",
          output: {
            assetFileNames: (assetInfo) => {
              if (assetInfo.name && assetInfo.name.endsWith(".css")) {
                return "styles/[name].[ext]";
              }
              return "assets/[name].[ext]";
            },
          },
        },
        cssCodeSplit: false,
        sourcemap: true,
        minify: false,
      },
    };
  } else {
    // App build configuration
    return {
      ...baseConfig,
      plugins: [
        ...baseConfig.plugins,
        inlineThemeBootstrap(
          resolve(import.meta.dirname, "src/theme/bootstrap.ts")
        ),
        contentSecurityPolicy(contentSecurityPolicyDirectives),
        warnIfWatchingWithoutSubmodule("inspect_ai"),
        copyToPythonRepo(),
      ],
      mode: "development",
      base: "",
      // Overrides postcss.config.cjs, whose inlining is for the library's
      // self-contained stylesheet: the app serves its fonts as files, since
      // the viewer's CSP allows `font-src 'self'` but not `data:`.
      css: { postcss: {} },
      server: {
        // Pinned so `pnpm dev` from the root always gives inspect 5173 and
        // scout 5174 regardless of startup order (e2e uses 5175/5176).
        port: 5173,
        strictPort: true,
        proxy: {
          "/api": {
            target: viewServerUrl,
            changeOrigin: true,
            configure: rewriteLoopbackOrigin(viewServerUrl),
          },
        },
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        rollupOptions: {
          output: {
            entryFileNames: `assets/index.js`,
            chunkFileNames: `assets/[name].js`,
            assetFileNames: `assets/[name].[ext]`,
          },
        },
        sourcemap: true,
      },
    };
  }
});
