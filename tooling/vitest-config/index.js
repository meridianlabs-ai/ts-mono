import { globSync, readFileSync } from "node:fs";

import { defaultExclude, defaultInclude } from "vitest/config";

const ENVIRONMENT_DIRECTIVE =
  /^\s*(?:\/\/|\/\*\*?|\*)\s*@vitest-environment\s+(\S+)/m;
const MODULE_MOCK = /\bvi\.(?:mock|doMock|unmock|doUnmock|hoisted)\(/;

/** @param {string} file */
const classify = (file) => {
  const source = readFileSync(file, "utf8");
  const environment =
    ENVIRONMENT_DIRECTIVE.exec(source.slice(0, 2048))?.[1] ?? "node";
  if (environment !== "node") return "dom";
  return MODULE_MOCK.test(source) ? "mocked" : "pure";
};

/**
 * Splits a package's tests into Vitest projects by what each file needs from
 * its worker, so isolation is paid for only where it buys correctness.
 *
 * - `pure`: no DOM, no module mocks. Runs with `isolate: false`, sharing one
 *   module graph per worker, so the import and transform work that dominates
 *   these suites happens once instead of once per file.
 * - `mocked`: no DOM, but calls `vi.mock` or friends. Isolated, because a
 *   shared module registry lets one file's mocks leak into the next.
 * - `dom`: declares a DOM `@vitest-environment`. Isolated, because a shared
 *   jsdom leaks state between files.
 *
 * Membership is derived from the source, so adding a test needs no config
 * change: a new file lands in `pure` unless it declares an environment or
 * mocks a module.
 *
 * @param {import("vitest/config").ViteUserConfig} config the package's config;
 *   everything in it is inherited by every project via `extends: true`
 * @param {string} root the package directory (`import.meta.dirname`)
 * @returns {import("vitest/config").ViteUserConfig}
 */
export const splitTestEnvironments = (config, root) => {
  const test = config.test ?? {};
  const files = globSync(test.include ?? defaultInclude, {
    cwd: root,
    exclude: test.exclude ?? defaultExclude,
  }).sort();

  /** @type {Record<"pure" | "mocked" | "dom", string[]>} */
  const groups = { pure: [], mocked: [], dom: [] };
  for (const file of files) groups[classify(`${root}/${file}`)].push(file);

  const projects = [];
  if (groups.pure.length > 0) {
    projects.push({
      extends: true,
      test: {
        name: "pure",
        include: groups.pure,
        environment: "node",
        isolate: false,
      },
    });
  }
  if (groups.mocked.length > 0) {
    projects.push({
      extends: true,
      test: { name: "mocked", include: groups.mocked, environment: "node" },
    });
  }
  if (groups.dom.length > 0) {
    projects.push({
      extends: true,
      test: { name: "dom", include: groups.dom },
    });
  }
  const { include: _include, ...rootTest } = test;
  return { ...config, test: { ...rootTest, projects } };
};
