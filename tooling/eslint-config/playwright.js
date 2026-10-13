import playwright from "eslint-plugin-playwright";

const recommended = playwright.configs["flat/recommended"];

// Lint scripts run with --max-warnings 0, so the plugin's recommended "warn"
// rules are promoted to errors rather than left as warnings nobody reads.
const recommendedAsErrors = Object.fromEntries(
  Object.entries(recommended.rules).map(([name, level]) => [
    name,
    level === "off" ? "off" : "error",
  ])
);

/** Playwright rules for an app's e2e/ specs and its skills' drive/ specs. */
export default [
  {
    ...recommended,
    files: ["e2e/**/*.ts", ".agents/skills/*/drive/**/*.ts"],
    rules: {
      ...recommendedAsErrors,
      // Absence checks (a restore that must not fire, a debounce that must
      // not flush) can only be asserted after a fixed wait.
      "playwright/no-wait-for-timeout": "off",
      // Shared assertion helpers are named expect*.
      "playwright/expect-expect": [
        "error",
        { assertFunctionPatterns: ["^expect[A-Z]"] },
      ],
    },
  },
  {
    files: [".agents/skills/*/drive/**/*.ts"],
    rules: {
      // Drives run against whatever real logs the user points them at, so a
      // test whose fixture is absent must report as skipped. Unconditional
      // skips stay banned.
      "playwright/no-skipped-test": ["error", { allowConditional: true }],
    },
  },
];
