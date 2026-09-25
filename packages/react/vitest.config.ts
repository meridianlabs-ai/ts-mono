import { defineConfig } from "vitest/config";

import { splitTestEnvironments } from "@tsmono/vitest-config";

export default splitTestEnvironments(
  defineConfig({
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // Vitest empties CSS by default; mathjax.test.ts reads this one raw.
      css: { include: [/mathjax\.css/] },
    },
  }),
  import.meta.dirname
);
