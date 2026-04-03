/**
 * Detect whether ts-mono is mounted as a submodule of a Python repo.
 *
 * When mounted, the layout is:
 *   <python-repo>/src/<package>/_view/ts-mono/
 *
 * This module finds the monorepo root (via pnpm-workspace.yaml), then
 * walks up to locate the Python repo root and verifies the package name
 * in pyproject.toml.
 */
import { existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Walk up from startDir looking for a directory containing the given marker file.
 * @returns {string | null}
 */
function findAncestorWith(startDir, markerFile) {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, markerFile))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Find the Python repo root that contains this monorepo as a submodule.
 *
 * @param {string} packageName - Expected `name` value in pyproject.toml
 *   (e.g. "inspect_ai" or "inspect_scout").
 * @returns {string | null} Absolute path to the Python repo root, or null
 *   if not running as a submodule.
 */
export function findPythonRepoRoot(packageName) {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const monoRoot = findAncestorWith(thisDir, "pnpm-workspace.yaml");
  if (!monoRoot) return null;

  // ts-mono sits at <python-root>/src/<pkg>/_view/ts-mono/
  const candidate = resolve(monoRoot, "../../../..");
  const pyproject = join(candidate, "pyproject.toml");

  if (existsSync(pyproject)) {
    const content = readFileSync(pyproject, "utf-8");
    if (content.includes(`name = "${packageName}"`)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Return the Python repo root or throw.
 *
 * @param {string} packageName - Expected `name` value in pyproject.toml.
 * @returns {string} Absolute path to the Python repo root.
 */
export function requirePythonRepoRoot(packageName) {
  const root = findPythonRepoRoot(packageName);
  if (root === null) {
    throw new Error(
      `Not running as a ${packageName} submodule. ` +
        "This script requires the TS monorepo to be mounted at " +
        `src/${packageName}/_view/ts-mono/ inside the Python repo.`
    );
  }
  return root;
}
