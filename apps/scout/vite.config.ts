import { cpSync, rmSync } from "fs";
import { join, resolve } from "path";

import react from "@vitejs/plugin-react";
import pc from "picocolors";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

import {
  findPythonRepoRoot,
  warnIfWatchingWithoutSubmodule,
} from "../../tooling/python-repo/index.js";
import { inlineThemeBootstrap } from "../../tooling/vite-plugins/index.js";

function copyToPythonRepo(): Plugin {
  return {
    name: "copy-to-python-repo",
    closeBundle() {
      const pythonRoot = findPythonRepoRoot("inspect_scout");
      if (!pythonRoot) return;
      const target = join(pythonRoot, "src/inspect_scout/_view/dist");
      rmSync(target, { recursive: true, force: true });
      cpSync("dist", target, { recursive: true });
      console.log(
        `${pc.cyan("[vite]")} ${pc.bold("Copied")} dist → ${pc.dim(target)}`
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isLibrary = mode === "library";
  const baseConfig = {
    plugins: [
      react({
        jsxRuntime: "automatic",
      }),
    ],
    define: {
      __DEV_WATCH__: JSON.stringify(process.env.DEV_LOGGING === "true"),
      __LOGGING_FILTER__: JSON.stringify(
        process.env.DEV_LOGGING_NAMESPACES || "*"
      ),
      __SCOUT_RUN_SCAN__: JSON.stringify(process.env.SCOUT_RUN_SCAN === "true"),
    },
  };
  if (isLibrary) {
    // Library build configuration
    return {
      ...baseConfig,
      plugins: [
        ...baseConfig.plugins,
        dts({
          insertTypesEntry: true,
          exclude: ["**/*.test.ts", "**/*.test.tsx", "src/tests/**/*"],
        }),
      ],
      build: {
        outDir: "lib",
        lib: {
          entry: resolve(__dirname, "src/index.ts"),
          name: "InspectScoutLogViewer",
          fileName: "index",
          formats: ["es"],
        },
        rollupOptions: {
          // Externalize as regex so subpath imports like `react/jsx-runtime`
          // are also externalized. Without this, Rolldown bundles the CJS
          // versions and emits runtime `__require("react")` calls that
          // throw in browsers.
          //
          // mathjax is heavy and registers globals; keep it external so the
          // consumer installs/dedupes it once instead of each viewer
          // shipping its own copy.
          external: (id: string) =>
            /^(react|react-dom|@tanstack\/react-query)(\/|$)/.test(id) ||
            id === "mathjax-full" ||
            id.startsWith("mathjax-full/") ||
            id === "markdown-it-mathjax3",
          output: {
            globals: {
              react: "React",
              "react-dom": "ReactDOM",
            },
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
        inlineThemeBootstrap(resolve(__dirname, "src/theme/apply-theme.ts")),
        warnIfWatchingWithoutSubmodule("inspect_scout"),
        copyToPythonRepo(),
      ],
      base: "",
      server: {
        proxy: {
          "/api": {
            target: "http://127.0.0.1:7576",
            changeOrigin: true,
          },
        },
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: mode !== "development",
        // Inline small assets (icons, decorative images) to save round trips
        // but emit larger ones (icon fonts especially) as separate hashed
        // files so they don't bloat the critical CSS payload.
        assetsInlineLimit: 8192,
        rollupOptions: {
          output: {
            manualChunks(id) {
              // Let mathxyjax3's pre-built chunks stay separate —
              // they use a global MathJax object set up by their entry
              // and break if inlined out of order.
              if (id.includes("mathxyjax3/dist/") && !id.endsWith("index.js")) {
                return undefined;
              }
              // Everything else goes into the main bundle
            },
            entryFileNames: `assets/[name]-[hash].js`,
            chunkFileNames: `assets/[name]-[hash].js`,
            assetFileNames: `assets/[name]-[hash].[ext]`,
          },
        },
        sourcemap: true,
      },
    };
  }
});
