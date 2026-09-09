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

export default tseslint.config(
  ...baseConfig,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      // eslint-plugin-react still calls context APIs removed in ESLint 10
      // (e.g. context.getFilename); fixup shims them until it ships v10 support.
      react: fixupPluginRules(reactPlugin),
      "react-hooks": reactHooksPlugin,
      "react-refresh": reactRefreshPlugin,
      "jsx-a11y": jsxA11yPlugin,
      tsmono: { rules: { "no-raw-use-effect": noRawUseEffect } },
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
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  }
);
