import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";

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
const libraryOutDir = resolve(import.meta.dirname, "lib");

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

const declarationSourceExtensionImport =
  /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'][^"']+)\.tsx?(["'])/g;

const declarationModuleSpecifier =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const declarationBarrels: Record<string, string> = {
  "/packages/inspect-components/src/index.d.ts": [
    "export { DisplayModeContext } from './content/DisplayModeContext';",
    "export type { DisplayMode } from './content/DisplayModeContext';",
    "",
  ].join("\n"),
  "/packages/inspect-components/src/chat/index.d.ts": [
    "export { ChatView } from './ChatView';",
    "export type { ChatViewProps } from './ChatView';",
    [
      "export type { ChatViewDisplayOptions, ChatViewLabelOptions,",
      "ChatViewLinkingOptions, ChatViewToolOptions } from './types';",
    ].join(" "),
    "export type { MessageRow, MessageRowOptions } from './rowsModel';",
    "",
  ].join("\n"),
  "/packages/inspect-components/src/transcript/index.d.ts": [
    "export { TranscriptLayout } from './TranscriptLayout';",
    "export type { TranscriptLayoutProps, TranscriptLayoutTimelineProps } from './TranscriptLayout';",
    "export { TranscriptOutline } from './outline/TranscriptOutline';",
    "export { TranscriptViewNodes } from './TranscriptViewNodes';",
    "export type { TranscriptViewNodesHandle, TranscriptViewNodesProps } from './TranscriptViewNodes';",
    "export { treeifyEvents } from './transform/treeify';",
    "export type { EventNode, TranscriptCollapseState } from './types';",
    "export { convertServerTimeline } from './timeline/core';",
    "export { TimelineSelector } from './timeline/components';",
    "export type { TimelineSelectorProps } from './timeline/components';",
    "",
  ].join("\n"),
  "/packages/react/src/state/index.d.ts": [
    "export type { ComponentStateHooks } from './ComponentStateContext';",
    "",
  ].join("\n"),
  "/packages/react/src/virtual/index.d.ts": [
    "export type { VirtualListHandle, VirtualListStateSnapshot } from './types';",
    "",
  ].join("\n"),
  "/packages/react/src/components/index.d.ts": [
    "export type { ComponentNavigation } from './ComponentNavigationContext';",
    "export type { MarkdownReference } from './MarkdownDivWithReferences';",
    "export type { MarkdownRenderer } from './MarkdownDiv';",
    "",
  ].join("\n"),
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

function collectDeclarationFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDeclarationFiles(path));
    } else if (path.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

function declarationTargetCandidates(targetPath: string): string[] {
  const extension = extname(targetPath);
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(extension)) {
    return [`${targetPath.slice(0, -extension.length)}.d.ts`];
  }
  if (extension) return [targetPath];
  return [targetPath, `${targetPath}.d.ts`, join(targetPath, "index.d.ts")];
}

function isDeclarationFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function collectReachableDeclarations(
  entryPath: string,
  rootDir: string
): Set<string> {
  const reachable = new Set<string>();
  const pending = [entryPath];
  while (pending.length > 0) {
    const declaration = pending.pop();
    if (
      !declaration ||
      reachable.has(declaration) ||
      !isDeclarationFile(declaration)
    ) {
      continue;
    }
    reachable.add(declaration);
    const content = readFileSync(declaration, "utf8");
    for (const match of content.matchAll(declarationModuleSpecifier)) {
      const specifier = match[1] ?? match[2] ?? "";
      if (!specifier.startsWith(".")) continue;
      const targetPath = resolve(dirname(declaration), specifier);
      const relativeTarget = relative(rootDir, targetPath);
      if (
        relativeTarget === ".." ||
        relativeTarget.startsWith("../") ||
        relativeTarget.startsWith("..\\") ||
        isAbsolute(relativeTarget)
      ) {
        continue;
      }
      for (const candidate of declarationTargetCandidates(targetPath)) {
        if (isDeclarationFile(candidate)) pending.push(candidate);
      }
    }
  }
  return reachable;
}

function pruneUnreachableDeclarations(outDir: string): Plugin {
  return {
    name: "prune-unreachable-declarations",
    closeBundle() {
      const entryPath = join(outDir, "index.d.ts");
      if (!existsSync(entryPath)) {
        throw new Error(`missing declaration entry ${entryPath}`);
      }
      const reachable = collectReachableDeclarations(entryPath, outDir);
      for (const declaration of collectDeclarationFiles(outDir)) {
        if (!reachable.has(declaration)) rmSync(declaration);
      }
    },
  };
}

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
          beforeWriteFile: (filePath, content) => {
            const absolutePath = isAbsolute(filePath)
              ? filePath
              : resolve(filePath);
            const outputPath = relative(libraryOutDir, absolutePath).replaceAll(
              "\\",
              "/"
            );
            if (testDeclarationPath.test(outputPath)) return false;
            const normalizedPath = absolutePath.replaceAll("\\", "/");
            for (const [suffix, declarationContent] of Object.entries(
              declarationBarrels
            )) {
              if (normalizedPath.endsWith(suffix)) {
                return {
                  content: declarationContent.replace(
                    declarationSourceExtensionImport,
                    "$1.js$2"
                  ),
                };
              }
            }
            const rewrittenContent = content.replace(
              declarationSourceExtensionImport,
              "$1.js$2"
            );
            return rewrittenContent === content
              ? undefined
              : { content: rewrittenContent };
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
        pruneUnreachableDeclarations(libraryOutDir),
      ],
      build: {
        outDir: libraryOutDir,
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
