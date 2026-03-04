import { join, resolve } from "path";

import react from "@vitejs/plugin-react";
import pc from "picocolors";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

import { findPythonRepoRoot } from "./scripts/python-repo.js";

function resolveOutputDir(): string {
  const pythonRoot = findPythonRepoRoot();
  if (pythonRoot) {
    const outDir = join(pythonRoot, "src/inspect_scout/_view/dist");
    console.log(
      `${pc.cyan("[vite]")} ${pc.bold(pc.red("Running as inspect_scout submodule"))} — output: ${pc.dim(outDir)}`
    );
    return outDir;
  }

  return "dist";
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
          external: ["react", "react-dom", "@tanstack/react-query"],
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
        outDir: resolveOutputDir(),
        emptyOutDir: true,
        minify: mode !== "development",
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
