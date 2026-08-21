import cssModulesKit from "@css-modules-kit/eslint-plugin";
import css from "@eslint/css";
import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importPlugin from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

// Everything JS/TS-flavored must be files-scoped: unscoped blocks apply to
// every linted file, and JS rules / TS parser options crash on the css
// language used by the *.module.css block below.
const jsish = "**/*.{js,mjs,cjs,jsx,ts,tsx}";

// Editor eslint servers keep a long-lived typescript program that never sees
// regenerated *.module.css.d.ts files until a server restart
// (typescript-eslint FAQ; microsoft/vscode-eslint#1774), so on the resulting
// error-typed styles.<class> expressions the no-unsafe rule family
// false-positives, duplicating the precise ts(2339) tsserver already shows
// live. No editor-host detection is reliable across all eslint servers, so
// the gate is inverted: the family is off unless the batch pipeline opts in.
// Every package's `lint` script sets TSMONO_TYPED_LINT=1 inline, so
// `pnpm lint`, per-package/--filter lint runs, turbo, and CI all enforce it;
// editor servers (which load ESLint via its API, never through the scripts)
// don't. Set the var in an editor server's env to force the rules on there.
const typedLint =
  !!process.env.TSMONO_TYPED_LINT && process.env.TSMONO_TYPED_LINT !== "0";

export default tseslint.config(
  // cmk-generated CSS-module typings; regenerated on every build, never linted
  { ignores: ["**/*.module.css.d.ts"] },
  { ...js.configs.recommended, files: [jsish] },
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: c.files ?? [jsish],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "import-x": importPlugin,
    },
    rules: {
      "import-x/no-duplicates": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      // Disallow `void` as an escape hatch for floating promises — prefixing a
      // hanging promise with `void` silently drops errors. Mark genuine cases
      // with an eslint-disable-next-line comment so the issue stays visible.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
    },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
  },
  { ...prettierConfig, files: [jsish] },
  ...(typedLint
    ? []
    : [
        {
          files: ["**/*.{ts,tsx}"],
          rules: {
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
          },
        },
      ]),
  {
    // CSS modules only: class names in plain global stylesheets are consumed
    // as strings, so an unused-class check there cannot be trusted. @eslint/css
    // provides the css language only; its style rules are not adopted.
    files: ["**/*.module.css"],
    language: "css/css",
    // tolerant: :global()/::part() aren't in css-tree's grammar; consequently
    // genuine css parse errors are not reported here either (cmk still parses).
    languageOptions: { tolerant: true },
    plugins: { css },
    extends: [cssModulesKit.configs.recommended],
    rules: {
      // Enforces same-basename css/component pairing; shared modules (e.g.
      // gridCells.module.css) are legitimate here.
      "css-modules-kit/no-missing-component-file": "off",
    },
  }
);
