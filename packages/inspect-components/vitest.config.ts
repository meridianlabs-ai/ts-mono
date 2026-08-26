import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

// vi.mock() is unreliable under a shared module cache (isolate: false): a
// file that ran earlier in the same worker may already have evaluated the
// mocked module — or an importer of it — and those cached copies win over
// the mock. Every test file that registers a module mock must run in the
// isolated project below, so detect them by content scan rather than a
// hand-kept list: a new vi.mock() file that silently landed in the shared
// project would reintroduce an order-dependent, CI-only flake.
const findModuleMockingTests = (root: string): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.test\.tsx?$/.test(entry.name)) {
        if (/\bvi\.(mock|doMock)\(/.test(readFileSync(path, "utf8")))
          found.push(relative(import.meta.dirname, path));
      }
    }
  };
  walk(root);
  return found.sort();
};

const moduleMockingTests = findModuleMockingTests(
  join(import.meta.dirname, "src")
);

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
      // A project with an empty include errors, so only materialize it while
      // module-mocking test files exist.
      ...(moduleMockingTests.length > 0
        ? [
            {
              test: {
                name: "isolated",
                environment: "jsdom",
                setupFiles: ["./vitest.setup.ts"],
                include: moduleMockingTests,
              },
            },
          ]
        : []),
    ],
  },
});
