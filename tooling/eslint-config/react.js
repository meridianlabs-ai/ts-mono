import { fixupPluginRules } from "@eslint/compat";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactRefreshPlugin from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

import baseConfig from "./base.js";

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
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  }
);
