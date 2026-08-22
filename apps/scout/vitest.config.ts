import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __SCOUT_RUN_SCAN__: "true",
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup-msw.ts"],
  },
});
