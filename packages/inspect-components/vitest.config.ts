import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Reuse each worker's jsdom across files: per-file boot was 4x the
    // suite's total CPU and regressed inspect_ai CI 39s -> 55s (#579)
    isolate: false,
  },
});
