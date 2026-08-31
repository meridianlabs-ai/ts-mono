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
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
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
  // The sanctioned carve-out: the named wrapper hooks' own implementations
  // are the one place raw useEffect/useLayoutEffect is allowed.
  {
    files: ["src/hooks/**"],
    rules: { "tsmono/no-raw-use-effect": "off" },
  }
);
