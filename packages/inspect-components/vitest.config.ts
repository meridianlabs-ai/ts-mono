import { defineConfig } from "vitest/config";

import { splitTestEnvironments } from "@tsmono/vitest-config";

export default splitTestEnvironments(
  defineConfig({
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // ansi-output ships a UMD file in a "type": "module" package, so Node
      // loads it with no exports; Vite's transform (as in the app) handles it.
      server: { deps: { inline: ["ansi-output"] } },
    },
  }),
  import.meta.dirname
);
