import { defineConfig } from "vitest/config";

import { splitTestEnvironments } from "@tsmono/vitest-config";

export default splitTestEnvironments(
  defineConfig({
    test: {
      setupFiles: ["./vitest.setup.ts"],
    },
  }),
  import.meta.dirname
);
