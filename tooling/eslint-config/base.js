import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importPlugin from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "import-x": importPlugin,
    },
    rules: {
      "import-x/no-duplicates": "error",
      // Disallow `void` as an escape hatch for floating promises — prefixing a
      // hanging promise with `void` silently drops errors. Mark genuine cases
      // with an eslint-disable-next-line comment so the issue stays visible.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
    },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
  },
  prettierConfig
);
