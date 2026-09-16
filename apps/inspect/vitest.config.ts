import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom boots per test file and was ~50% of this package's CI test time;
    // files that render opt in with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**"],
    setupFiles: ["src/setupTests.ts"],
    css: {
      modules: {
        classNameStrategy: "non-scoped",
      },
    },
  },
});
