/**
 * Detect whether this app is mounted as a submodule of the inspect_ai Python repo.
 *
 * When the TS monorepo lives at src/inspect_ai/_view/ts-mono/, the Python
 * repo root is six directories up from apps/inspect/.  We verify by checking for
 * pyproject.toml containing `name = "inspect_ai"`.
 */
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

/** Absolute path to the Python repo root, or `null` when running standalone. */
export function findPythonRepoRoot() {
  const candidate = resolve(__dirname, "../../../../../../..");
  const pyproject = join(candidate, "pyproject.toml");

  if (existsSync(pyproject)) {
    const content = readFileSync(pyproject, "utf-8");
    if (content.includes('name = "inspect_ai"')) {
      return candidate;
    }
  }

  return null;
}

/**
 * Return the Python repo root or throw if not in submodule mode.
 *
 * Use this in scripts that only make sense when mounted as a submodule
 * (e.g. type generation, which needs files from the Python repo).
 */
export function requirePythonRepoRoot() {
  const root = findPythonRepoRoot();
  if (root === null) {
    throw new Error(
      "Not running as an inspect_ai submodule. " +
        "This script requires the TS monorepo to be mounted at " +
        "src/inspect_ai/_view/ts-mono/ inside the Python repo."
    );
  }
  return root;
}
