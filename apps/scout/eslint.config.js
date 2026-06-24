import tseslint from "typescript-eslint";

import reactConfig from "@tsmono/eslint-config/react";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "build/",
      "scripts/",
      "playwright-report/",
      "test-results/",
      "*.config.?s",
      "*.config.cjs",
      "src/types/generated.ts",
    ],
  },
  ...reactConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.js", "*.config.ts", "*.config.cjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Legacy code overrides — disabled rules that haven't been fixed yet
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
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  }
);
