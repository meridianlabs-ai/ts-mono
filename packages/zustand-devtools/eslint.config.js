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
  // TODO(a11y): pre-existing violations from enabling eslint-plugin-jsx-a11y.
  // Remove this block as the underlying issues are fixed.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
    },
  }
);
