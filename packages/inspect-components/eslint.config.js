import tseslint from "typescript-eslint";

import reactConfig from "@tsmono/eslint-config/react";

export default tseslint.config(
  {
    ignores: ["node_modules/", "dist/", "eslint.config.js"],
  },
  ...reactConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Test helpers / fixture files — allow _-prefixed unused vars for API compat
  {
    files: ["**/*.test.ts", "**/testHelpers.ts", "**/syntheticNodes.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
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
      "jsx-a11y/media-has-caption": "off",
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/no-noninteractive-tabindex": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/role-supports-aria-props": "off",
    },
  }
);
