import { fixupPluginRules } from "@eslint/compat";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactRefreshPlugin from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

import baseConfig from "./base.js";

// Raw effects are banned repo-wide: application code reaches for a hook from
// @tsmono/react/hooks whose name states the scenario, so a reader gets intent
// without reconstructing effect timing. The wrappers' own implementations
// (packages/react/src/hooks/**) are the one sanctioned carve-out — that
// package's eslint config turns this rule off there. Everything else goes
// through the suppressions.json ratchet.
const noRawUseEffect = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Forbid raw useEffect/useLayoutEffect outside the sanctioned wrapper hooks",
    },
    schema: [],
    messages: {
      rawEffect:
        "Raw {{name}} is forbidden. Use a named hook from @tsmono/react/hooks " +
        "(useMountEffect, useUnmount, useEventListener, useOnClickOutside, " +
        "useInterval, useTimeout, useLatestRef, useDocumentTitle, " +
        "useResizeObserver, ...) or restructure per " +
        "react.dev/learn/you-might-not-need-an-effect.",
    },
  },
  create(context) {
    const banned = new Set(["useEffect", "useLayoutEffect"]);
    return {
      CallExpression(node) {
        const { callee } = node;
        const name =
          callee.type === "Identifier" && banned.has(callee.name)
            ? callee.name
            : callee.type === "MemberExpression" &&
                !callee.computed &&
                callee.property.type === "Identifier" &&
                banned.has(callee.property.name)
              ? callee.property.name
              : null;
        if (name) {
          context.report({
            node: callee,
            messageId: "rawEffect",
            data: { name },
          });
        }
      },
    };
  },
};

// Log content can be untrusted model output (a log may set
// `trust_content=False`). Media elements render it richly, so each must sit
// inside <RequireTrustedContent>, which withholds it for untrusted content.
// Raw HTML is confined to the markdown renderer, which checks trust itself.
const MEDIA_ELEMENTS = new Set([
  "audio",
  "embed",
  "iframe",
  "img",
  "object",
  "video",
]);
const RAW_HTML_FILES = ["packages/react/src/components/MarkdownDiv.tsx"];

const requireTrustedContent = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require media elements to be gated by content trust and confine raw HTML to the markdown renderer",
    },
    schema: [],
    messages: {
      media:
        "<{{name}}> can render untrusted log content. Wrap it in " +
        "<RequireTrustedContent> from @tsmono/react/components.",
      rawHtml:
        "dangerouslySetInnerHTML can render untrusted log content. Render " +
        "markdown through MarkdownDiv, which checks content trust.",
    },
  },
  create(context) {
    const rawHtmlAllowed = RAW_HTML_FILES.some((file) =>
      context.filename.endsWith(file)
    );
    const insideTrustGate = (node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          parent.type === "JSXElement" &&
          parent.openingElement.name.type === "JSXIdentifier" &&
          parent.openingElement.name.name === "RequireTrustedContent"
        ) {
          return true;
        }
      }
      return false;
    };
    return {
      JSXOpeningElement(node) {
        if (
          node.name.type === "JSXIdentifier" &&
          MEDIA_ELEMENTS.has(node.name.name) &&
          !insideTrustGate(node.parent)
        ) {
          context.report({
            node,
            messageId: "media",
            data: { name: node.name.name },
          });
        }
      },
      JSXAttribute(node) {
        if (
          node.name.type === "JSXIdentifier" &&
          node.name.name === "dangerouslySetInnerHTML" &&
          !rawHtmlAllowed
        ) {
          context.report({ node, messageId: "rawHtml" });
        }
      },
    };
  },
};

// Libraries that interpret log content richly. They're loaded on demand, and
// only for trusted content, through a few modules; importing them anywhere
// else would load (and could run) them for untrusted content too.
const RICH_RENDERING_PACKAGES = [
  "ansi-output",
  "asciinema-player",
  "dompurify",
  "markdown-it",
  "markdown-it-mathjax3",
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
const moduleName = (path) => path.replace(/^.*\//, "").replace(/\.tsx?$/, "");
const ON_DEMAND_MODULE_NAMES = ON_DEMAND_MODULES.map(moduleName);

const lazyRenderingLibraries = {
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
        "tooling/eslint-config/react.js).",
      staticModule:
        "'{{source}}' pulls a rich-rendering library into every page. Load " +
        "it with import() from its trust-checking component instead.",
      dynamicLoad:
        "Only the trust-checking components (ON_DEMAND_LOADERS in " +
        "tooling/eslint-config/react.js) may load '{{source}}'.",
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
        if (node.source.type !== "Literal" || isTest) {
          return;
        }
        const source = String(node.source.value);
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

export default tseslint.config(...baseConfig, {
  files: ["**/*.{ts,tsx}"],
  plugins: {
    // eslint-plugin-react still calls context APIs removed in ESLint 10
    // (e.g. context.getFilename); fixup shims them until it ships v10 support.
    react: fixupPluginRules(reactPlugin),
    "react-hooks": reactHooksPlugin,
    "react-refresh": reactRefreshPlugin,
    "jsx-a11y": jsxA11yPlugin,
    tsmono: {
      rules: {
        "no-raw-use-effect": noRawUseEffect,
        "require-trusted-content": requireTrustedContent,
        "lazy-rendering-libraries": lazyRenderingLibraries,
      },
    },
  },
  rules: {
    ...reactPlugin.configs.recommended.rules,
    ...reactPlugin.configs["jsx-runtime"].rules,
    "react/prop-types": "off",
    ...reactHooksPlugin.configs.recommended.rules,
    ...jsxA11yPlugin.flatConfigs.recommended.rules,
    // The rule can't see what a custom component does with an `autoFocus`
    // prop, so flagging non-DOM elements is guesswork. Real DOM autoFocus
    // is still an error.
    "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
    "tsmono/no-raw-use-effect": "error",
    "tsmono/require-trusted-content": "error",
    "tsmono/lazy-rendering-libraries": "error",
  },
  settings: {
    react: {
      version: "detect",
    },
  },
});
