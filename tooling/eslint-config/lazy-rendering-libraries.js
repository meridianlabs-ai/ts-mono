// Libraries that interpret log content richly. They're loaded on demand, and
// only for trusted content, through a few modules; importing them anywhere
// else would load (and could run) them for untrusted content too.
const RICH_RENDERING_PACKAGES = [
  "ansi-output",
  "asciinema-player",
  "dompurify",
  "markdown-it",
  "markdown-it-mathjax3",
  "mathjax-full",
  "prismjs",
];
// Styling only; safe to load unconditionally.
const RICH_RENDERING_ALLOWED_IMPORTS = ["prismjs/themes/"];
// The on-demand modules: the only files that may import those libraries.
const ON_DEMAND_MODULES = [
  "packages/react/src/components/AnsiDisplayRich.tsx",
  "packages/react/src/components/AsciinemaPlayerImpl.tsx",
  "packages/react/src/components/markdownPipeline.ts",
  "packages/react/src/components/markdownRendering.ts",
  "packages/react/src/components/markdownTruncate.ts",
  "packages/react/src/components/renderedHtmlSanitizer.ts",
  "packages/react/src/hooks/prismHighlighter.ts",
  "packages/react/src/hooks/prismManual.ts",
];
// The trust-checking components that load the on-demand modules with a
// dynamic import() when content is trusted.
const ON_DEMAND_LOADERS = [
  "packages/react/src/components/AnsiDisplay.tsx",
  "packages/react/src/components/AsciinemaPlayer.tsx",
  "packages/react/src/components/MarkdownDiv.tsx",
  "packages/react/src/hooks/usePrismHighlight.ts",
];
const moduleName = (path) =>
  path.replace(/^.*\//, "").replace(/\.[cm]?[jt]sx?$/, "");
const ON_DEMAND_MODULE_NAMES = ON_DEMAND_MODULES.map(moduleName);

export const lazyRenderingLibraries = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep rich-rendering libraries behind the on-demand modules that load only for trusted content",
    },
    schema: [],
    messages: {
      library:
        "'{{source}}' would load for untrusted content. Import it only from " +
        "the on-demand modules (ON_DEMAND_MODULES in " +
        "tooling/eslint-config/lazy-rendering-libraries.js).",
      staticModule:
        "'{{source}}' pulls a rich-rendering library into every page. Load " +
        "it with import() from its trust-checking component instead.",
      dynamicLoad:
        "Only the trust-checking components (ON_DEMAND_LOADERS in " +
        "tooling/eslint-config/lazy-rendering-libraries.js) may load '{{source}}'.",
    },
  },
  create(context) {
    const filename = context.filename;
    const isFile = (files) => files.some((file) => filename.endsWith(file));
    const isTest = /\.test\.tsx?$/.test(filename);
    const isOnDemandModule = isFile(ON_DEMAND_MODULES);
    const isLoader = isFile(ON_DEMAND_LOADERS);
    const isPackage = (source) =>
      !RICH_RENDERING_ALLOWED_IMPORTS.some((allowed) =>
        source.startsWith(allowed)
      ) &&
      RICH_RENDERING_PACKAGES.some(
        (pkg) => source === pkg || source.startsWith(`${pkg}/`)
      );
    const isOnDemandModuleSource = (source) =>
      source.startsWith(".") &&
      ON_DEMAND_MODULE_NAMES.includes(moduleName(source));

    const checkStatic = (node, source, typeOnly) => {
      if (typeOnly || isTest || isOnDemandModule) {
        return;
      }
      if (isPackage(source)) {
        context.report({ node, messageId: "library", data: { source } });
      } else if (isOnDemandModuleSource(source)) {
        context.report({ node, messageId: "staticModule", data: { source } });
      }
    };

    return {
      ImportDeclaration(node) {
        checkStatic(node, node.source.value, node.importKind === "type");
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkStatic(node, node.source.value, node.exportKind === "type");
        }
      },
      ExportAllDeclaration(node) {
        checkStatic(node, node.source.value, node.exportKind === "type");
      },
      ImportExpression(node) {
        if (isTest) {
          return;
        }
        const source =
          node.source.type === "Literal"
            ? String(node.source.value)
            : node.source.type === "TemplateLiteral" &&
                node.source.expressions.length === 0
              ? node.source.quasis[0].value.cooked
              : undefined;
        if (source === undefined) {
          return;
        }
        if (
          (isPackage(source) || isOnDemandModuleSource(source)) &&
          !isLoader &&
          !isOnDemandModule
        ) {
          context.report({ node, messageId: "dynamicLoad", data: { source } });
        }
      },
    };
  },
};
