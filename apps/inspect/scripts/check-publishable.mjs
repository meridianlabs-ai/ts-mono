// Guards against the `workspace:` protocol leaking into consumer-facing
// dependency fields. The library build inlines all @tsmono/* code into
// lib/index.js, so those packages must NOT be declared as runtime deps —
// otherwise `npm install @meridianlabs/log-viewer` tries to resolve e.g.
// "@tsmono/util": "workspace:*" from the public registry and fails.
// (npm publish ships workspace: specs verbatim; it does not rewrite them.)
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const consumerFacing = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];
const offenders = [];
for (const field of consumerFacing) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (typeof spec === "string" && spec.startsWith("workspace:")) {
      offenders.push(`${field}.${name} = "${spec}"`);
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `\n${pkg.name}: workspace: protocol found in consumer-facing dependencies.\n` +
      offenders.map((o) => `  - ${o}`).join("\n") +
      `\n\nThese will not resolve for external installers. Workspace packages are\n` +
      `bundled into the library build, so move them to devDependencies.\n`
  );
  process.exit(1);
}

const libDir = join(here, "..", "lib");
const typeEntry = join(libDir, "index.d.ts");
if (!existsSync(typeEntry)) {
  console.error(
    `\n${pkg.name}: missing built declaration entry ${typeEntry}.\n`
  );
  process.exit(1);
}

function declarationFilesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return declarationFilesUnder(path);
    return path.endsWith(".d.ts") ? [path] : [];
  });
}

const privateTypeImports = [];
const testDeclarations = [];
const testDeclarationPath =
  /(^|\/)(e2e|test|testing)(\/|$)|(^|\/)([^/]*\.test|testFixtures|testHelpers|testClientApi|testDescriptors|testStore|syntheticNodes)\.d\.ts$/;
for (const declaration of declarationFilesUnder(libDir)) {
  const packagePath = relative(libDir, declaration).replaceAll("\\", "/");
  const content = readFileSync(declaration, "utf8");
  if (/\b(?:from\s*|import\s*\(\s*)["']@tsmono\//.test(content)) {
    privateTypeImports.push(packagePath);
  }
  if (testDeclarationPath.test(packagePath)) {
    testDeclarations.push(packagePath);
  }
}

if (privateTypeImports.length > 0 || testDeclarations.length > 0) {
  console.error(`\n${pkg.name}: invalid consumer-facing declarations.`);
  if (privateTypeImports.length > 0) {
    console.error(
      `\nPrivate @tsmono imports remain:\n${privateTypeImports.map((path) => `  - ${path}`).join("\n")}`
    );
  }
  if (testDeclarations.length > 0) {
    console.error(
      `\nTest-only declarations would ship:\n${testDeclarations.map((path) => `  - ${path}`).join("\n")}`
    );
  }
  console.error();
  process.exit(1);
}
