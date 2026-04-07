import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**"],
    setupFiles: ["src/tests/setupTests.ts"],
    environment: "jsdom",
    globals: true,
  },
});
