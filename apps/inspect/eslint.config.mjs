import globals from "globals";
import tseslint from "typescript-eslint";

import { barrelOnly } from "@tsmono/eslint-config/barrel-only";
import reactConfig from "@tsmono/eslint-config/react";

export default tseslint.config(
  {
    ignores: [
      "libs/",
      "dist/",
      "lib/",
      "node_modules/",
      "playwright-report/",
      "test-results/",
      "*.config.?s",
      "*.config.cjs",
      "src/types/log.d.ts",
    ],
  },
  ...reactConfig,
  ...barrelOnly(["app_config", "log_data"]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        __VIEW_SERVER_API_URL__: "readonly",
        __DEV_WATCH__: "readonly",
        __LOGGING_FILTER__: "readonly",
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.js", "*.config.ts", "*.config.cjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // The base rule is replaced by @typescript-eslint/no-unused-vars below
      // (the canonical typescript-eslint pairing).
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // TODO(a11y): pre-existing violations from enabling eslint-plugin-jsx-a11y.
  // Remove this block as the underlying issues are fixed.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "jsx-a11y/anchor-is-valid": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/label-has-associated-control": "off",
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/no-noninteractive-tabindex": "off",
      "jsx-a11y/no-static-element-interactions": "off",
    },
  }
);
