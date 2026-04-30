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

import getVersionInfo from "./scripts/get-version.js";

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
  const versionInfo = getVersionInfo();

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
      __VIEWER_VERSION__: JSON.stringify(versionInfo.version),
      __VIEWER_COMMIT__: JSON.stringify(versionInfo.commitHash),
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
          external: ["react", "react-dom"],
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
