import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, test } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");

const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-e2e",
  "lib",
  "coverage",
  "storybook-static",
  "test-results",
  "playwright-report",
]);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(css|tsx?)$/.test(entry.name) ? [path] : [];
  });

// A read with a fallback (`var(--bs-x, ...)`) is allowed to be undefined.
const READ = /(?<=var\(\s*)--bs-[\w-]+(?=\s*\))/g;
const DEFINITION = /--bs-[\w-]+(?=["']?\s*:)/g;
// Bootstrap reads these but never defines them (they are optional Sass
// settings), so each property falls back to its initial or inherited value.
const DELIBERATELY_UNDEFINED = new Set([
  "--bs-body-text-align",
  "--bs-nav-link-font-size",
  "--bs-breadcrumb-font-size",
]);

test("every --bs-* variable read without a fallback is defined", () => {
  const files = ["apps", "packages"].flatMap((dir) =>
    sourceFiles(join(repoRoot, dir))
  );
  const defined = new Set<string>();
  const reads = new Map<string, Set<string>>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const name of text.match(DEFINITION) ?? []) defined.add(name);
    for (const name of text.match(READ) ?? []) {
      const readers = reads.get(name) ?? new Set();
      readers.add(relative(repoRoot, file));
      reads.set(name, readers);
    }
  }

  const undefinedReads = [...reads]
    .filter(([name]) => !defined.has(name) && !DELIBERATELY_UNDEFINED.has(name))
    .map(([name, readers]) => `${name}: ${[...readers].join(", ")}`);

  expect(reads.size).toBeGreaterThan(0);
  expect(undefinedReads).toEqual([]);
});
