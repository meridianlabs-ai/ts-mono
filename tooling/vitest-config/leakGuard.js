import { afterAll, beforeAll, vi } from "vitest";

// Globals that pure tests are known to replace (fetch, timers, Date) plus the
// rest of the timer and scheduling surface. Anything a test swaps here and
// does not put back would follow it into the next file in the worker.
const WATCHED_GLOBALS = [
  "fetch",
  "Date",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "performance",
  "structuredClone",
  "AbortController",
  "Request",
  "Response",
  "Headers",
  "URL",
  "TextEncoder",
  "TextDecoder",
  "console",
  "Worker",
];

/** @type {Map<string, unknown>} */
const originals = new Map();

// Registered after the package's own setup files (this file is appended to
// their setupFiles), so anything a setup file installs is already in place.
beforeAll(() => {
  for (const name of WATCHED_GLOBALS) originals.set(name, globalThis[name]);
});

// Runs with `sequence.hooks: "stack"` semantics, i.e. after every afterAll
// the test file registered, so a file that restores in its own teardown is
// judged after that teardown. Vitest's own restoreAllMocks() runs after this
// hook, so an unrestored `vi.spyOn`/`vi.stubGlobal` mock is not a leak.
afterAll(() => {
  const leaks = [];
  if (vi.isFakeTimers()) {
    // Fake timers replace Date and the timer globals too; one message covers
    // them all.
    leaks.push("fake timers are still installed (call vi.useRealTimers())");
  } else {
    for (const [name, original] of originals) {
      const current = globalThis[name];
      if (current === original || vi.isMockFunction(current)) continue;
      leaks.push(`globalThis.${name} was replaced and not restored`);
    }
  }
  if (leaks.length > 0) {
    throw new Error(
      `This test file runs non-isolated (project "pure") and leaked state ` +
        `into its worker; the next file to run there would inherit it:\n` +
        leaks.map((leak) => `  - ${leak}`).join("\n")
    );
  }
});
