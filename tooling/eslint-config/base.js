import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      import: importPlugin,
    },
    rules: {
      "import/no-duplicates": "error",
    },
    settings: {
      "import/resolver": {
        typescript: true,
        node: true,
      },
    },
  },
  prettierConfig
);
