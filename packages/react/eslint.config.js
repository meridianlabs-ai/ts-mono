import tseslint from "typescript-eslint";

import reactConfig from "@tsmono/eslint-config/react";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "storybook-static/",
      "eslint.config.js",
    ],
  },
  ...reactConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.js",
            ".storybook/*.ts",
            "vitest.config.ts",
            "vitest.setup.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // TODO(a11y): pre-existing violations from enabling eslint-plugin-jsx-a11y.
  // Remove this block as the underlying issues are fixed.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/no-static-element-interactions": "off",
    },
  }
);
