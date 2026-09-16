import { defineConfig } from "vitest/config";

// One vitest process for the whole workspace: every package's own
// vitest.config.ts still applies per project, but a single worker pool is
// shared instead of one pool per package competing for the runner's cores.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
});
