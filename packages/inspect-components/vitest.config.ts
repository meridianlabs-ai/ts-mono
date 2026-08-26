import { configDefaults, defineConfig } from "vitest/config";

// vi.mock() is unreliable under a shared module cache (isolate: false): a
// file that ran earlier in the same worker may already have evaluated the
// mocked module — or an importer of it — and those cached copies win over
// the mock. Any test file that vi.mock()s a module must run in the
// isolated project below.
const moduleMockingTests = [
  "src/transcript/TranscriptViewNodes.test.tsx",
  "src/transcript/event/StopReasonBadge.test.tsx",
  "src/transcript/outline/useOutlineScrollSync.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared-jsdom",
          environment: "jsdom",
          // Reuse each worker's jsdom across files: per-file boot was 4x the
          // suite's total CPU and regressed inspect_ai CI 39s -> 55s (#579)
          isolate: false,
          setupFiles: ["./vitest.setup.ts"],
          exclude: [...configDefaults.exclude, ...moduleMockingTests],
        },
      },
      {
        test: {
          name: "isolated",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: moduleMockingTests,
        },
      },
    ],
  },
});
