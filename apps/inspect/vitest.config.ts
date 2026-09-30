import { defineConfig } from "vitest/config";

import { splitTestEnvironments } from "@tsmono/vitest-config";

export default splitTestEnvironments(
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      exclude: ["e2e/**"],
      setupFiles: ["src/setupTests.ts"],
      css: {
        modules: {
          classNameStrategy: "non-scoped",
        },
      },
    },
  }),
  import.meta.dirname
);
