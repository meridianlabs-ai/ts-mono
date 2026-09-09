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
  inlineThemeBootstrap,
  rewriteLoopbackOrigin,
} from "../../tooling/vite-plugins/index.js";

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

const viewServerUrl = "http://127.0.0.1:7575";

const declarationAliases = Object.entries({
  "@tsmono/inspect-common": "packages/inspect-common/src/types/index",
  "@tsmono/inspect-common/normalize":
    "packages/inspect-common/src/normalize/index",
  "@tsmono/inspect-common/query": "packages/inspect-common/src/query/index",
  "@tsmono/inspect-common/types": "packages/inspect-common/src/types/index",
  "@tsmono/inspect-common/utils": "packages/inspect-common/src/utils/index",
  "@tsmono/inspect-components": "packages/inspect-components/src/index",
  "@tsmono/inspect-components/chat":
    "packages/inspect-components/src/chat/index",
  "@tsmono/inspect-components/columnFilter":
    "packages/inspect-components/src/columnFilter/index",
  "@tsmono/inspect-components/transcript":
    "packages/inspect-components/src/transcript/index",
  "@tsmono/inspect-components/transcript-search":
    "packages/inspect-components/src/transcript-search/index",
  "@tsmono/inspect-components/usage":
    "packages/inspect-components/src/usage/index",
  "@tsmono/react/components": "packages/react/src/components/index",
  "@tsmono/react/hooks": "packages/react/src/hooks/index",
  "@tsmono/react/state": "packages/react/src/state/index",
  "@tsmono/react/virtual": "packages/react/src/virtual/index",
  "@tsmono/scout-components/sentinels":
    "packages/scout-components/src/sentinels/index",
  "@tsmono/theme/bootstrap": "packages/theme/src/bootstrap",
  "@tsmono/util": "packages/util/src/index",
})
  .sort(([left], [right]) => right.length - left.length)
  .map(([find, replacement]) => ({
    find,
    replacement: resolve(import.meta.dirname, "../..", replacement),
  }));

const testDeclarationPath =
  /(^|\/)(e2e|test|testing)(\/|$)|(^|\/)([^/]*\.test|testFixtures|testHelpers|testClientApi|testDescriptors|testStore|syntheticNodes)\.d\.ts(?:\.map)?$/;

const declarationBarrels: Record<string, string> = {
  "/packages/react/src/hooks/index.d.ts":
    "export * from './useScrollDirection';\n",
  "/packages/util/src/index.d.ts": [
    "export * from './asyncData';",
    "export * from './http';",
    "export * from './json-value';",
    "export * from './vscode';",
    "",
  ].join("\n"),
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
      root: resolve(import.meta.dirname, "../.."),
      plugins: [
        ...baseConfig.plugins,
        dts({
          entryRoot: resolve(import.meta.dirname, "../.."),
          tsconfigPath: resolve(import.meta.dirname, "tsconfig.lib.json"),
          aliases: declarationAliases,
          beforeWriteFile: (filePath) => {
            const normalizedPath = filePath.replaceAll("\\", "/");
            if (testDeclarationPath.test(normalizedPath)) return false;
            for (const [suffix, content] of Object.entries(
              declarationBarrels
            )) {
              if (normalizedPath.endsWith(suffix)) return { content };
            }
            return undefined;
          },
          insertTypesEntry: true,
          exclude: [
            "**/*.test.ts",
            "**/*.test.tsx",
            "**/*.stories.ts",
            "**/*.stories.tsx",
            "**/e2e/**",
            "**/test/**",
            "**/testing/**",
            "**/testFixtures.ts",
            "**/testHelpers.ts",
            "**/syntheticNodes.ts",
            "**/setupTests.ts",
          ],
        }),
      ],
      build: {
        outDir: resolve(import.meta.dirname, "lib"),
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
        warnIfWatchingWithoutSubmodule("inspect_ai"),
        copyToPythonRepo(),
      ],
      mode: "development",
      base: "",
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
