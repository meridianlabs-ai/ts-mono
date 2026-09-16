import { globSync, readFileSync } from "node:fs";

// Vitest's own defaults, restated because a project-level `include` replaces
// them wholesale.
const DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.{idea,git,cache,output,temp}/**",
  "**/{vite,vitest,playwright}.config.*",
];

const DIRECTIVE = /^\s*(?:\/\/|\/\*\*?|\*)\s*@vitest-environment\s+(\S+)/m;

/** @param {string} file */
const declaredEnvironment = (file) =>
  DIRECTIVE.exec(readFileSync(file, "utf8").slice(0, 2048))?.[1] ?? "node";

/**
 * Splits a package's tests into two Vitest projects keyed on the per-file
 * `@vitest-environment` directive.
 *
 * Tests without a directive (or with `node`) run in the `pure` project with
 * `isolate: false`: they share one module graph per worker, so the import and
 * transform work that dominates these suites happens once instead of once per
 * file. Tests that declare a DOM environment run in the `dom` project with the
 * default per-file isolation, because a shared jsdom leaks state between files.
 *
 * The directive stays the single source of truth: a new test lands in `pure`
 * unless it opts into a DOM, and a `pure` test that turns out to depend on
 * module state can opt out by declaring an environment.
 *
 * @param {import("vitest/config").ViteUserConfig} config the package's config;
 *   everything in it is inherited by both projects via `extends: true`
 * @param {string} root the package directory (`import.meta.dirname`)
 * @returns {import("vitest/config").ViteUserConfig}
 */
export const splitTestEnvironments = (config, root) => {
  const test = config.test ?? {};
  const files = globSync(test.include ?? DEFAULT_INCLUDE, {
    cwd: root,
    exclude: test.exclude ?? DEFAULT_EXCLUDE,
  }).sort();
  const dom = files.filter(
    (f) => declaredEnvironment(`${root}/${f}`) !== "node"
  );
  const pure = files.filter((f) => !dom.includes(f));

  const projects = [];
  if (pure.length > 0) {
    projects.push({
      extends: true,
      test: {
        name: "pure",
        include: pure,
        environment: "node",
        isolate: false,
      },
    });
  }
  if (dom.length > 0) {
    projects.push({ extends: true, test: { name: "dom", include: dom } });
  }
  const { include: _include, ...rootTest } = test;
  return { ...config, test: { ...rootTest, projects } };
};
