import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the theming contract:
 *
 * 1. Bootstrap was removed in favor of the `--inspect-*` tokens and the
 *    `data-theme` attribute (tokens.css / reboot.css / utilities.css /
 *    apply-theme.ts). A single stray `var(--bs-...)` or `data-bs-theme`
 *    resolves to nothing at runtime and regresses silently, so fail fast.
 *
 * 2. `--inspect-*` names are owned by packages/theme. Code elsewhere may
 *    *override* a name on a subtree (re-skinning a component), but must not
 *    mint new names — that silently expands the surface without review.
 *    Component locals belong under a different prefix (e.g. `--event-panel-*`).
 *
 * 3. The PUBLIC re-theming surface (the small set of inputs a downstream
 *    embedder overrides, documented in packages/theme/README.md) must stay
 *    defined. A positive check on the contract — not a count of all tokens,
 *    which would only reward bloat.
 */

// The public input tokens — the whole surface a downstream re-themes. Keep in
// sync with packages/theme/README.md and packages/theme/src/theme.css.
const PUBLIC_INPUTS = [
  "--inspect-foreground",
  "--inspect-background",
  "--inspect-surface",
  "--inspect-border",
  "--inspect-primary",
  "--inspect-danger",
  "--inspect-success",
  "--inspect-warning",
  "--inspect-link",
  "--inspect-code-foreground",
  "--inspect-radius",
  "--inspect-font-family",
  "--inspect-font-mono",
  "--inspect-font-size-base",
  "--inspect-font-weight",
  "--inspect-line-height",
];

const REPO_ROOT = resolve(__dirname, "../../..");
// Source only: design/ and docs/ (and *.md generally) may mention --bs- when
// discussing the migration itself; "lib" matches the vite library outDir.
const SCANNED_ROOTS = ["apps", "packages", "tooling"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".css", ".html"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", "lib", "coverage"]);

const collectFiles = (dir: string, out: string[]): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name))
        collectFiles(join(dir, entry.name), out);
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
};

const sourceFiles = SCANNED_ROOTS.flatMap((root) =>
  collectFiles(join(REPO_ROOT, root), [])
);

const offenders = (pattern: RegExp): string[] =>
  sourceFiles
    .filter((file) => !file.endsWith("theme-contract.test.ts"))
    .flatMap((file) => {
      const lines = readFileSync(file, "utf8").split("\n");
      return lines
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => pattern.test(line))
        .map(({ line, i }) => `${file}:${i + 1}: ${line.trim()}`);
    });

describe("bootstrap removal contract", () => {
  it("finds a sane number of source files", () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it("has no --bs- CSS variable references", () => {
    expect(offenders(/--bs-/)).toEqual([]);
  });

  it("has no data-bs-theme attribute usage", () => {
    expect(offenders(/data-bs-theme/)).toEqual([]);
  });

  it("has no bootstrap package imports (bootstrap-icons is allowed)", () => {
    expect(
      offenders(/from\s+["']bootstrap["']|import\s+["']bootstrap\//)
    ).toEqual([]);
  });
});

describe("--inspect-* names are owned by packages/theme", () => {
  const themeDir = join(REPO_ROOT, "packages/theme/src");
  const themeNames = new Set(
    readdirSync(themeDir)
      .filter((name) => name.endsWith(".css"))
      .flatMap(
        (name) =>
          readFileSync(join(themeDir, name), "utf8").match(
            /--inspect-[a-z0-9-]+/g
          ) ?? []
      )
  );

  it("defines the whole public re-theming surface", () => {
    const missing = PUBLIC_INPUTS.filter((name) => !themeNames.has(name));
    expect(missing).toEqual([]);
  });

  it("definitions outside packages/theme only override existing contract names", () => {
    const minted = sourceFiles
      .filter((file) => !file.includes(join("packages", "theme", "src")))
      .flatMap((file) => {
        const lines = readFileSync(file, "utf8").split("\n");
        return (
          lines
            .map((line, i) => ({ line, i }))
            // CSS declarations and TSX inline-style keys ("--inspect-x": ...)
            .filter(({ line }) =>
              /^\s*["']?--inspect-[a-z0-9-]+["']?\s*:/.test(line)
            )
            .filter(({ line }) => {
              const name = line.match(/--inspect-[a-z0-9-]+/)?.[0] ?? "";
              return !themeNames.has(name);
            })
            .map(({ line, i }) => `${file}:${i + 1}: ${line.trim()}`)
        );
      });
    expect(
      minted,
      "no new --inspect-* names may be minted outside packages/theme — override an existing contract token on a subtree, or use a --_* local"
    ).toEqual([]);
  });

  it("every var(--inspect-*) reference resolves to a defined token", () => {
    // Reference integrity: a token consumed via var() — including from .ts/.tsx
    // as an inline-style string (e.g. colorScale.ts) — must be defined in the
    // theme package, else it resolves to nothing at runtime with no build/lint
    // error. Guards against a "remove unused token" pass deleting a
    // grep-invisible JS-string consumer, and against a typo'd var() read.
    const defined = new Set(
      readdirSync(themeDir)
        .filter((name) => name.endsWith(".css"))
        .flatMap(
          (name) =>
            readFileSync(join(themeDir, name), "utf8").match(
              /--inspect-[a-z0-9-]+(?=\s*:)/g
            ) ?? []
        )
    );
    const undefinedRefs = [
      ...new Set(
        sourceFiles.flatMap((file) =>
          [
            ...readFileSync(file, "utf8").matchAll(
              /var\(\s*(--inspect-[a-z0-9-]+)/g
            ),
          ]
            .map((match) => match[1])
            .filter((name) => !defined.has(name))
        )
      ),
    ];
    expect(
      undefinedRefs,
      "var(--inspect-*) references (incl. .ts inline-style strings) must resolve to a token defined in packages/theme — a deleted/typo'd token resolves to nothing at runtime"
    ).toEqual([]);
  });
});
