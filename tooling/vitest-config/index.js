import { globSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultExclude, defaultInclude } from "vitest/config";

// Same pattern Vitest itself uses to detect a per-file environment, so the
// classification here can never disagree with the environment a file runs in.
const ENVIRONMENT_DIRECTIVE = /@(?:vitest|jest)-environment\s+([\w-]+)\b/;
const MODULE_MOCK =
  /\bvi\.(?:mock|doMock|unmock|doUnmock|hoisted|resetModules|importMock)\(/;
const NO_UNSAFE_EVAL_DIRECTIVE = /@no-unsafe-eval\b/;
// The comments before a file's first statement, where the directive belongs:
// a test that only mentions it in a string or a later comment isn't marked.
const LEADING_COMMENTS = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*/;

// What a Content-Security-Policy without 'unsafe-eval' does in the browser:
// eval and new Function throw EvalError.
const NO_UNSAFE_EVAL_ARGV = ["--disallow-code-generation-from-strings"];

/**
 * @param {string} file
 * @param {string} defaultEnvironment the root `test.environment`, which is
 *   what Vitest falls back to for a file without a directive
 */
const classify = (file, defaultEnvironment) => {
  const source = readFileSync(file, "utf8");
  const environment =
    ENVIRONMENT_DIRECTIVE.exec(source)?.[1] ?? defaultEnvironment;
  const header = LEADING_COMMENTS.exec(source)?.[0] ?? "";
  if (NO_UNSAFE_EVAL_DIRECTIVE.test(header)) {
    // The DOM environments load modules by evaluating strings, so the flag
    // would fail the file before it runs a test.
    if (environment !== "node") {
      throw new Error(
        `${file}: @no-unsafe-eval needs the node environment, not ${environment}`
      );
    }
    return "noUnsafeEval";
  }
  if (environment !== "node") return "dom";
  return MODULE_MOCK.test(source) ? "mocked" : "pure";
};

const WATCH_ARGS = new Set(["watch", "dev", "--watch", "-w"]);
const RUN_ARGS = new Set(["run", "--run", "list", "--watch=false"]);

// Membership is computed once when the config loads, so in watch mode a test
// file created or reclassified later would run in no project at all. Watch
// runs keep the plain single-project config instead. Mirrors Vitest's own
// resolution: an explicit command or flag wins, otherwise its default of
// `!CI && stdin.isTTY`, so `vitest list` and `vitest --run` show the same
// project layout CI runs.
const isWatchMode = () => {
  const argv = process.argv.slice(2);
  if (argv.some((arg) => RUN_ARGS.has(arg))) return false;
  if (argv.some((arg) => WATCH_ARGS.has(arg) || arg === "--watch=true")) {
    return true;
  }
  return !process.env.CI && Boolean(process.stdin.isTTY);
};

/**
 * Splits a package's tests into Vitest projects by what each file needs from
 * its worker, so isolation is paid for only where it buys correctness.
 *
 * - `pure`: no DOM, no module mocks. Runs with `isolate: false`, sharing one
 *   module graph per worker, so the import and transform work that dominates
 *   these suites happens once instead of once per file. Tests here own the
 *   restoration of anything they stub (`vi.unstubAllGlobals`,
 *   `vi.useRealTimers`, reassigned globals like `fetch`) and the cleanup of
 *   any state persisted through globals that setup-file imports install
 *   (e.g. `fake-indexeddb`: Vitest re-runs the setup file per test file but
 *   not its imports, so one IndexedDB lives for the whole worker). Vitest
 *   restores spies between files but none of the above. `leakGuard.js` runs
 *   after every pure file and fails it if fake timers or a replaced core
 *   global were left behind, so a leak fails the file that caused it rather
 *   than some later file that happened to share the worker.
 * - `mocked`: no DOM, but calls `vi.mock` or friends. Isolated, because a
 *   shared module registry lets one file's mocks leak into the next.
 * - `dom`: declares a DOM `@vitest-environment`. Isolated, because a shared
 *   jsdom leaks state between files.
 *
 * - `no-unsafe-eval`: a node-environment file that contains the
 *   `@no-unsafe-eval` directive. Isolated, and run with V8's
 *   `--disallow-code-generation-from-strings`, so code it reaches fails the
 *   way it would under a Content-Security-Policy without 'unsafe-eval'.
 *
 * Membership is derived from the source, so adding a test needs no config
 * change: a new file lands in `pure` unless it declares an environment,
 * mocks a module or opts out of eval. The split is skipped in watch mode
 * (see `isWatchMode`), so watch runs don't apply the eval ban.
 *
 * @param {import("vitest/config").ViteUserConfig} config the package's config;
 *   everything in it is inherited by every project via `extends: true`
 * @param {string} root the package directory (`import.meta.dirname`)
 * @returns {import("vitest/config").ViteUserConfig}
 */
export const splitTestEnvironments = (config, root) => {
  if (isWatchMode()) return config;

  const test = config.test ?? {};
  const defaultEnvironment = test.environment ?? "node";
  const files = globSync(test.include ?? defaultInclude, {
    cwd: root,
    exclude: test.exclude ?? defaultExclude,
  })
    .map((file) => file.split(sep).join("/"))
    .sort();

  /** @type {Record<"pure" | "mocked" | "dom" | "noUnsafeEval", string[]>} */
  const groups = { pure: [], mocked: [], dom: [], noUnsafeEval: [] };
  for (const file of files) {
    groups[classify(`${root}/${file}`, defaultEnvironment)].push(file);
  }

  const projects = [];
  if (groups.pure.length > 0) {
    projects.push({
      extends: true,
      test: {
        name: "pure",
        include: groups.pure,
        environment: "node",
        isolate: false,
        // Appended to the inherited setupFiles (mergeConfig concatenates
        // arrays), so it registers its hooks after the package's own setup.
        setupFiles: [fileURLToPath(new URL("./leakGuard.js", import.meta.url))],
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
  if (groups.noUnsafeEval.length > 0) {
    projects.push({
      extends: true,
      test: {
        name: "no-unsafe-eval",
        include: groups.noUnsafeEval,
        environment: "node",
        // worker_threads reject V8 flags in execArgv
        pool: "forks",
        execArgv: NO_UNSAFE_EVAL_ARGV,
      },
    });
  }
  const { include: _include, ...rootTest } = test;
  return { ...config, test: { ...rootTest, projects } };
};
