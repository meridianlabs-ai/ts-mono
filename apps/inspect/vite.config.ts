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

export default defineConfig(({ mode }) => {
  const isLibrary = mode === "library";

  const baseConfig = {
    plugins: [
      react({
        jsxRuntime: "automatic",
        fastRefresh: !isLibrary,
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
        dts({
          insertTypesEntry: true,
          exclude: ["**/*.test.ts", "**/*.test.tsx", "src/setupTests.ts"],
        }),
      ],
      build: {
        outDir: "lib",
        lib: {
          entry: resolve(__dirname, "src/index.ts"),
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
          external: (id: string) =>
            /^(react|react-dom)(\/|$)/.test(id) ||
            id === "mathjax-full" ||
            id.startsWith("mathjax-full/") ||
            id === "markdown-it-mathjax3",
          output: {
            globals: {
              react: "React",
              "react-dom": "ReactDOM",
              "react-router-dom": "ReactRouterDOM",
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
        inlineThemeBootstrap(resolve(__dirname, "src/theme/bootstrap.ts")),
        warnIfWatchingWithoutSubmodule("inspect_ai"),
        copyToPythonRepo(),
      ],
      mode: "development",
      base: "",
      server: {
        proxy: {
          "/api": {
            target: "http://127.0.0.1:7575",
            changeOrigin: true,
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
