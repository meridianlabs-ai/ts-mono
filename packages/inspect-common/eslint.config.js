import tseslint from "typescript-eslint";

import baseConfig from "@tsmono/eslint-config/base";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "scripts/",
      "src/types/generated.ts",
      "eslint.config.js",
    ],
  },
  ...baseConfig,
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
  }
);
