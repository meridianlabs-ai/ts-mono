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
// inside <RequireMedia>, which withholds it when media is denied.
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
// An <a> whose href isn't a string literal could point at a log-supplied
// destination. Log-derived links go through ExternalLink or MediaReference,
// which render inert text when links are denied; the other files build their
// destinations from application data (routes, tabs, the git origin, docs).
const DYNAMIC_LINK_FILES = [
  "packages/inspect-components/src/content/ExternalLink.tsx",
  "packages/inspect-components/src/media/MediaReference.tsx",
  "packages/inspect-components/src/transcript/event/EventPanel.tsx",
  "packages/inspect-components/src/transcript/outline/OutlineRow.tsx",
  "packages/react/src/components/inAppLink.tsx",
  "packages/react/src/components/NextPreviousNav.tsx",
  "packages/react/src/components/SegmentedControl.tsx",
  "packages/react/src/components/TabSet.tsx",
  "apps/inspect/src/app/log-view/tabs/TaskTab.tsx",
  "apps/inspect/src/app/samples/transcript/search/SearchScoutUnavailable.tsx",
  "apps/inspect/src/app/shared/data-grid/DataGrid.tsx",
];

const requireMediaPermission = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require media elements to be gated by content trust, links to log-derived destinations to use ExternalLink, highlightable code to use ContentCode, and raw HTML to stay in the markdown renderer",
    },
    schema: [],
    messages: {
      media:
        "<{{name}}> can render untrusted log content. Wrap it in " +
        "<RequireMedia> from @tsmono/react/components.",
      dynamicLink:
        "<a> with a computed href can link to untrusted log content. Use " +
        "<ExternalLink> from @tsmono/inspect-components/content, which " +
        "renders inert text when links aren't permitted. A link built only " +
        "from application data belongs in DYNAMIC_LINK_FILES " +
        "(tooling/eslint-config/react.js).",
      rawHtml:
        "dangerouslySetInnerHTML can render untrusted log content. Render " +
        "markdown through MarkdownDiv, which checks content trust.",
      highlightableCode:
        "A <code> with a language- class is highlighted by Prism in place. " +
        "Render it with <ContentCode> from @tsmono/react/components, which " +
        "marks untrusted code and keeps React's text in step with Prism.",
    },
  },
  create(context) {
    const allowedIn = (files) =>
      files.some((file) => context.filename.endsWith(file));
    const rawHtmlAllowed = allowedIn(RAW_HTML_FILES);
    const dynamicLinkAllowed = allowedIn(DYNAMIC_LINK_FILES);
    // A spread can carry an href too.
    const hasDynamicHref = (node) =>
      node.attributes.some(
        (attribute) =>
          attribute.type === "JSXSpreadAttribute" ||
          (attribute.name.name === "href" &&
            attribute.value?.type === "JSXExpressionContainer" &&
            !(
              attribute.value.expression.type === "Literal" &&
              typeof attribute.value.expression.value === "string"
            ))
      );
    const insideTrustGate = (node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          parent.type === "JSXElement" &&
          parent.openingElement.name.type === "JSXIdentifier" &&
          parent.openingElement.name.name === "RequireMedia"
        ) {
          return true;
        }
      }
      return false;
    };
    // Prism highlights any `pre code` whose class names a language.
    const isHighlightableCode = (node) =>
      node.name.type === "JSXIdentifier" &&
      node.name.name === "code" &&
      node.attributes.some(
        (attribute) =>
          attribute.type === "JSXAttribute" &&
          attribute.name.name === "className" &&
          attribute.value !== null &&
          context.sourceCode.getText(attribute.value).includes("language-")
      );
    return {
      JSXOpeningElement(node) {
        if (
          !dynamicLinkAllowed &&
          node.name.type === "JSXIdentifier" &&
          node.name.name === "a" &&
          hasDynamicHref(node)
        ) {
          context.report({ node, messageId: "dynamicLink" });
        }
        if (isHighlightableCode(node)) {
          context.report({ node, messageId: "highlightableCode" });
        }
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
        "require-media-permission": requireMediaPermission,
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
    "tsmono/require-media-permission": "error",
  },
  settings: {
    react: {
      version: "detect",
    },
  },
});
