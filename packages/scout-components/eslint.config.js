import tseslint from "typescript-eslint";

import reactConfig from "@tsmono/eslint-config/react";

export default tseslint.config(
  {
    ignores: ["node_modules/", "dist/", "eslint.config.js"],
  },
  ...reactConfig,
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
