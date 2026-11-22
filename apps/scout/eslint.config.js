import tseslint from "typescript-eslint";

import playwrightConfig from "@tsmono/eslint-config/playwright";
import reactConfig from "@tsmono/eslint-config/react";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "dist-e2e/",
      "lib/",
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
  ...playwrightConfig,
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.js", "*.config.ts", "*.config.cjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }
);
