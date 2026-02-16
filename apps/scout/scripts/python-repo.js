/**
 * Detect whether this app is mounted as a submodule of the inspect_scout Python repo.
 *
 * When the TS monorepo lives at src/inspect_scout/_view/frontend/, the Python
 * repo root is six directories up from apps/scout/.  We verify by checking for
 * pyproject.toml containing `name = "inspect_scout"`.
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
    if (content.includes('name = "inspect_scout"')) {
      return candidate;
    }
  }

  return null;
}

/**
 * Return the Python repo root or throw if not in submodule mode.
 *
 * Use this in scripts that only make sense when mounted as a submodule
 * (e.g. type generation, which needs openapi.json from the Python repo).
 */
export function requirePythonRepoRoot() {
  const root = findPythonRepoRoot();
  if (root === null) {
    throw new Error(
      "Not running as an inspect_scout submodule. " +
        "Type generation requires the TS monorepo to be mounted at " +
        "src/inspect_scout/_view/frontend/ inside the Python repo."
    );
  }
  return root;
}
