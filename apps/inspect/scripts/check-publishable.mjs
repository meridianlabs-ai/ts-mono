// Guards the package boundary that consumers get from npm pack/publish.
// Workspace packages are bundled into lib/index.js, and declarations must
// resolve only to files that ship inside this package.
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const scriptPath = fileURLToPath(import.meta.url);
const here = dirname(scriptPath);
const defaultPackageRoot = resolve(here, "..");

function isRecord(value) {
  if (typeof value !== "object" || value === null) return false;
  return !Array.isArray(value);
}

function pathStaysInside(parent, child) {
  const childPath = relative(parent, child);
  if (childPath === "") return true;
  if (isAbsolute(childPath)) return false;
  return (
    childPath !== ".." &&
    !childPath.startsWith("../") &&
    !childPath.startsWith("..\\")
  );
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function packagePath(packageRoot, path) {
  return relative(packageRoot, path).replaceAll("\\", "/");
}

function packageTargetPath(packageRoot, errors, target, label) {
  if (typeof target !== "string") {
    errors.push(`${label} must be a string package path.`);
    return undefined;
  }
  if (!target.startsWith("./")) {
    errors.push(
      `${label} must start with "./", got ${JSON.stringify(target)}.`
    );
    return undefined;
  }
  if (target.includes("*")) {
    errors.push(`${label} must resolve to a concrete file, got ${target}.`);
    return undefined;
  }
  const resolvedPath = resolve(packageRoot, target);
  if (!pathStaysInside(packageRoot, resolvedPath)) {
    errors.push(`${label} escapes the package root: ${target}.`);
    return undefined;
  }
  return resolvedPath;
}

function collectPackageTargets(packageRoot, errors, value, label, targets) {
  if (typeof value === "string") {
    const targetPath = packageTargetPath(packageRoot, errors, value, label);
    if (targetPath) targets.push({ label, target: value, path: targetPath });
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${label} must be a string or conditional export object.`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    collectPackageTargets(
      packageRoot,
      errors,
      nested,
      `${label}.${key}`,
      targets
    );
  }
}

function filesUnder(directory, extension) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesUnder(path, extension));
    } else if (path.endsWith(extension)) {
      files.push(path);
    }
  }
  return files;
}

function moduleSpecifiers(content) {
  const specs = [];
  const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
  const searchable = withoutBlockComments.replace(/(^|[^:])\/\/.*$/gm, "$1");
  const importStatementSpecifier =
    /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?["']([^"']+)["']/g;
  const exportStatementSpecifier =
    /(?:^|\n)\s*export\s+(?:type\s+)?[^'"]*?\s+from\s*["']([^"']+)["']/g;
  const importTypeSpecifier = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [
    importStatementSpecifier,
    exportStatementSpecifier,
    importTypeSpecifier,
  ]) {
    for (const match of searchable.matchAll(pattern)) {
      specs.push(match[1]);
    }
  }
  return specs;
}

function stylesheetUrls(content) {
  const urls = [];
  const searchable = content.replace(/\/\*[\s\S]*?\*\//g, "");
  const urlPattern =
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s][^'")]*(?:\s+[^'")]*)?))\s*\)/g;
  for (const match of searchable.matchAll(urlPattern)) {
    urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return urls;
}

function packageNameForSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0] ?? specifier;
}

function declarationTargetCandidates(targetPath) {
  const extension = extname(targetPath);
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(extension)) {
    return [`${targetPath.slice(0, -extension.length)}.d.ts`];
  }
  if (extension) return [targetPath];
  return [targetPath, `${targetPath}.d.ts`, join(targetPath, "index.d.ts")];
}

function collectReachableDeclarations(entryPath, libDir) {
  const reachable = new Set();
  const pending = [entryPath];
  while (pending.length > 0) {
    const declaration = pending.pop();
    if (!declaration || reachable.has(declaration) || !isFile(declaration)) {
      continue;
    }
    reachable.add(declaration);
    const content = readFileSync(declaration, "utf8");
    for (const specifier of moduleSpecifiers(content)) {
      if (!specifier.startsWith(".")) continue;
      const targetPath = resolve(dirname(declaration), specifier);
      if (!pathStaysInside(libDir, targetPath)) continue;
      for (const candidate of declarationTargetCandidates(targetPath)) {
        if (isFile(candidate)) pending.push(candidate);
      }
    }
  }
  return reachable;
}

function runtimeTargetCandidates(targetPath) {
  if (extname(targetPath)) return [targetPath];
  return [`${targetPath}.js`, join(targetPath, "index.js")];
}

function checkPublishable(packageRoot) {
  const pkgPath = join(packageRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const errors = [];
  const consumerFacing = [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  const workspaceDependencyOffenders = [];
  const privateDependencyOffenders = [];
  const declaredRuntimePackages = new Set();

  for (const field of consumerFacing) {
    const dependencies = pkg[field] ?? {};
    if (!isRecord(dependencies)) {
      errors.push(`${field} must be an object when present.`);
      continue;
    }
    for (const [name, spec] of Object.entries(dependencies)) {
      declaredRuntimePackages.add(name);
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        workspaceDependencyOffenders.push(`${field}.${name} = "${spec}"`);
      }
      if (name.startsWith("@tsmono/")) {
        privateDependencyOffenders.push(`${field}.${name} = "${spec}"`);
      }
    }
  }

  if (workspaceDependencyOffenders.length > 0) {
    errors.push(
      [
        "workspace: protocol found in consumer-facing dependencies:",
        ...workspaceDependencyOffenders.map((item) => `  - ${item}`),
      ].join("\n")
    );
  }
  if (privateDependencyOffenders.length > 0) {
    errors.push(
      [
        "private @tsmono packages declared as consumer dependencies:",
        ...privateDependencyOffenders.map((item) => `  - ${item}`),
      ].join("\n")
    );
  }

  if (pkg.sideEffects === false) {
    errors.push(
      "sideEffects=false would let consumer bundlers drop the exported stylesheet and viewer initialization side effects."
    );
  } else if (Array.isArray(pkg.sideEffects)) {
    const cssMarkedSideEffectful = pkg.sideEffects.some(
      (entry) =>
        typeof entry === "string" &&
        (entry === "./lib/styles/index.css" ||
          entry === "lib/styles/index.css" ||
          entry.includes("*.css"))
    );
    if (!cssMarkedSideEffectful) {
      errors.push(
        "sideEffects must include ./lib/styles/index.css when it is an allowlist."
      );
    }
  }

  const packageFiles = pkg.files;
  const packageFileRoots = [];
  if (!Array.isArray(packageFiles) || packageFiles.length === 0) {
    errors.push(
      "files must list the package payload; otherwise npm can publish source-only artifacts."
    );
  } else {
    for (const entry of packageFiles) {
      if (typeof entry !== "string" || entry.length === 0) {
        errors.push(
          `files entries must be non-empty strings, got ${JSON.stringify(entry)}.`
        );
        continue;
      }
      const normalizedEntry = entry.replaceAll("\\", "/");
      if (
        normalizedEntry.startsWith("/") ||
        normalizedEntry.split("/").includes("..") ||
        (normalizedEntry !== "lib" && !normalizedEntry.startsWith("lib/"))
      ) {
        errors.push(`files entry must stay under lib: ${entry}.`);
        continue;
      }
      const fileRoot = resolve(packageRoot, normalizedEntry);
      if (!pathStaysInside(packageRoot, fileRoot)) {
        errors.push(`files entry escapes the package root: ${entry}.`);
        continue;
      }
      if (!existsSync(fileRoot)) {
        errors.push(
          `files entry does not exist in the built output: ${entry}.`
        );
        continue;
      }
      packageFileRoots.push(fileRoot);
    }
  }

  const exportedTargets = [];
  for (const field of ["main", "module", "types"]) {
    collectPackageTargets(
      packageRoot,
      errors,
      pkg[field],
      field,
      exportedTargets
    );
  }
  if (pkg.main !== pkg.module) {
    errors.push(
      "main and module must point at the same single ESM library bundle."
    );
  }

  if (!isRecord(pkg.exports)) {
    errors.push("exports must be an object.");
  } else {
    const rootExport = pkg.exports["."];
    if (!isRecord(rootExport)) {
      errors.push('exports["."] must be a conditional export object.');
    } else {
      const rootConditions = Object.keys(rootExport);
      if (rootConditions[0] !== "types") {
        errors.push(
          'exports["."] must list the "types" condition before runtime conditions.'
        );
      }
      if (rootExport.types !== pkg.types) {
        errors.push('exports["."].types must match the top-level types entry.');
      }
      if (rootExport.import !== pkg.module) {
        errors.push(
          'exports["."].import must match the top-level module entry.'
        );
      }
    }
    if (pkg.exports["./styles/index.css"] !== "./lib/styles/index.css") {
      errors.push(
        'exports["./styles/index.css"] must point at ./lib/styles/index.css.'
      );
    }
    collectPackageTargets(
      packageRoot,
      errors,
      pkg.exports,
      "exports",
      exportedTargets
    );
  }

  const uncoveredTargets = [];
  const missingTargets = [];
  for (const { label, target, path } of exportedTargets) {
    if (!isFile(path)) {
      missingTargets.push(`${label} -> ${target}`);
    }
    if (
      packageFileRoots.length > 0 &&
      !packageFileRoots.some(
        (root) => root === path || pathStaysInside(root, path)
      )
    ) {
      uncoveredTargets.push(`${label} -> ${target}`);
    }
  }
  if (missingTargets.length > 0) {
    errors.push(
      [
        "package entry/export targets are missing:",
        ...missingTargets.map((item) => `  - ${item}`),
      ].join("\n")
    );
  }
  if (uncoveredTargets.length > 0) {
    errors.push(
      [
        "package entry/export targets are not covered by files:",
        ...uncoveredTargets.map((item) => `  - ${item}`),
      ].join("\n")
    );
  }

  const stylePath = packageTargetPath(
    packageRoot,
    errors,
    "./lib/styles/index.css",
    "stylesheet export"
  );
  if (stylePath && (!isFile(stylePath) || statSync(stylePath).size === 0)) {
    errors.push(
      "exported stylesheet is missing or empty: ./lib/styles/index.css."
    );
  }

  const libDir = join(packageRoot, "lib");
  if (!isDirectory(libDir)) {
    errors.push(
      "missing built lib directory; run the library build before publishing."
    );
  }

  if (errors.length === 0) {
    const declarationFiles = filesUnder(libDir, ".d.ts");
    const runtimeFiles = filesUnder(libDir, ".js");
    const stylesheetFiles = filesUnder(libDir, ".css");
    const reachableDeclarationFiles = collectReachableDeclarations(
      join(libDir, "index.d.ts"),
      libDir
    );
    const privateTypeImports = [];
    const privateRuntimeImports = [];
    const undeclaredTypeImports = [];
    const unresolvedTypeImports = [];
    const unresolvedRuntimeImports = [];
    const undeclaredRuntimeImports = [];
    const unresolvedStylesheetUrls = [];
    const unreachableDeclarations = [];
    const testDeclarations = [];
    const testDeclarationPath =
      /(^|\/)(e2e|test|testing)(\/|$)|(^|\/)([^/]*(?:\.test|testFixtures|testHelpers|testClientApi|testDescriptors|testStore|syntheticNodes))\.d\.ts$/;

    for (const declaration of declarationFiles) {
      const relativeDeclarationPath = relative(libDir, declaration).replaceAll(
        "\\",
        "/"
      );
      const formattedPath = packagePath(packageRoot, declaration);
      const content = readFileSync(declaration, "utf8");
      const inDeclarationClosure = reachableDeclarationFiles.has(declaration);
      if (!inDeclarationClosure) {
        unreachableDeclarations.push(formattedPath);
      }
      if (testDeclarationPath.test(relativeDeclarationPath)) {
        testDeclarations.push(formattedPath);
      }
      for (const specifier of moduleSpecifiers(content)) {
        if (specifier.startsWith("@tsmono/")) {
          privateTypeImports.push(`${formattedPath} -> ${specifier}`);
        }
        if (!inDeclarationClosure) continue;
        if (!specifier.startsWith(".")) {
          if (!specifier.startsWith("@tsmono/")) {
            const packageName = packageNameForSpecifier(specifier);
            if (!declaredRuntimePackages.has(packageName)) {
              undeclaredTypeImports.push(`${formattedPath} -> ${specifier}`);
            }
          }
          continue;
        }
        const targetPath = resolve(dirname(declaration), specifier);
        if (!pathStaysInside(libDir, targetPath)) {
          unresolvedTypeImports.push(
            `${formattedPath} -> ${specifier} (escapes lib)`
          );
          continue;
        }
        if (!declarationTargetCandidates(targetPath).some(isFile)) {
          unresolvedTypeImports.push(`${formattedPath} -> ${specifier}`);
        }
      }
    }

    for (const runtimeFile of runtimeFiles) {
      const formattedPath = packagePath(packageRoot, runtimeFile);
      const content = readFileSync(runtimeFile, "utf8");
      for (const specifier of moduleSpecifiers(content)) {
        if (specifier.startsWith("@tsmono/")) {
          privateRuntimeImports.push(`${formattedPath} -> ${specifier}`);
        }
        if (specifier.startsWith(".")) {
          const targetPath = resolve(dirname(runtimeFile), specifier);
          if (
            !pathStaysInside(libDir, targetPath) ||
            !runtimeTargetCandidates(targetPath).some(isFile)
          ) {
            unresolvedRuntimeImports.push(`${formattedPath} -> ${specifier}`);
          }
          continue;
        }
        const packageName = packageNameForSpecifier(specifier);
        if (!declaredRuntimePackages.has(packageName)) {
          undeclaredRuntimeImports.push(`${formattedPath} -> ${specifier}`);
        }
      }
    }

    for (const stylesheetFile of stylesheetFiles) {
      const formattedPath = packagePath(packageRoot, stylesheetFile);
      const content = readFileSync(stylesheetFile, "utf8");
      for (const url of stylesheetUrls(content)) {
        if (
          url === "" ||
          url.startsWith("#") ||
          url.startsWith("var(") ||
          /^(?:data|https?|blob|about):/i.test(url)
        ) {
          continue;
        }
        if (url.startsWith("/") || url.startsWith("file:")) {
          unresolvedStylesheetUrls.push(`${formattedPath} -> ${url}`);
          continue;
        }
        const assetPath = resolve(
          dirname(stylesheetFile),
          url.split(/[?#]/)[0]
        );
        if (!pathStaysInside(libDir, assetPath) || !isFile(assetPath)) {
          unresolvedStylesheetUrls.push(`${formattedPath} -> ${url}`);
        }
      }
    }

    if (unreachableDeclarations.length > 0) {
      errors.push(
        [
          "unreachable declarations would ship outside the public declaration closure:",
          ...unreachableDeclarations.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
    if (privateTypeImports.length > 0) {
      errors.push(
        [
          "private @tsmono imports remain in declarations:",
          ...privateTypeImports.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
    if (privateRuntimeImports.length > 0) {
      errors.push(
        [
          "private @tsmono imports remain in runtime output:",
          ...privateRuntimeImports.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
    if (unresolvedTypeImports.length > 0) {
      errors.push(
        [
          "declaration imports do not resolve inside lib:",
          ...unresolvedTypeImports.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
    if (undeclaredTypeImports.length > 0) {
      errors.push(
        [
          "declaration externals are not declared as dependencies or peers:",
          ...undeclaredTypeImports.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
    if (unresolvedRuntimeImports.length > 0) {
      errors.push(
        [
          "runtime relative imports do not resolve inside lib:",
          ...unresolvedRuntimeImports.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
    if (undeclaredRuntimeImports.length > 0) {
      errors.push(
        [
          "runtime externals are not declared as dependencies or peers:",
          ...undeclaredRuntimeImports.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
    if (unresolvedStylesheetUrls.length > 0) {
      errors.push(
        [
          "stylesheet urls do not resolve inside lib:",
          ...unresolvedStylesheetUrls.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
    if (testDeclarations.length > 0) {
      errors.push(
        [
          "test-only declarations would ship:",
          ...testDeclarations.map((item) => `  - ${item}`),
        ].join("\n")
      );
    }
  }

  return {
    label: typeof pkg.name === "string" ? pkg.name : pkgPath,
    errors,
  };
}

function formatErrors(label, errors) {
  return [
    `\n${label}: package is not publishable.`,
    errors.map((message, index) => `\n${index + 1}. ${message}`).join("\n"),
    "",
  ].join("\n");
}

function writeFixture(root, overrides = {}) {
  mkdirSync(join(root, "lib", "styles"), { recursive: true });
  const pkg = {
    name: "check-publishable-fixture",
    type: "module",
    main: "./lib/index.js",
    module: "./lib/index.js",
    types: "./lib/index.d.ts",
    files: ["lib"],
    exports: {
      ".": {
        types: "./lib/index.d.ts",
        import: "./lib/index.js",
      },
      "./styles/index.css": "./lib/styles/index.css",
    },
    dependencies: {
      react: "^19.0.0",
    },
    ...overrides.pkg,
  };
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(pkg, null, 2)}\n`
  );
  writeFileSync(
    join(root, "lib", "index.js"),
    "export const fixture = true;\n"
  );
  writeFileSync(
    join(root, "lib", "index.d.ts"),
    "export type { Fixture } from './fixture.js';\n"
  );
  writeFileSync(
    join(root, "lib", "fixture.d.ts"),
    "export interface Fixture { value: string; }\n"
  );
  writeFileSync(join(root, "lib", "styles", "index.css"), ".fixture {}\n");
  for (const [path, content] of Object.entries(overrides.files ?? {})) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function runFixture(overrides = {}) {
  const parent = mkdtempSync(join(tmpdir(), "check-publishable-self-test-"));
  const root = join(parent, "test", "fixture");
  mkdirSync(root, { recursive: true });
  try {
    writeFixture(root, overrides);
    return spawnSync(process.execPath, [scriptPath, "--package-root", root], {
      encoding: "utf8",
    });
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
}

function runSelfTest() {
  const cases = [
    {
      name: "accepts a self-contained package even under an absolute test path",
      expectedStatus: 0,
    },
    {
      name: "rejects undeclared declaration externals in the reachable closure",
      expectedStatus: 1,
      expectedStderr: "declaration externals are not declared",
      files: {
        "lib/fixture.d.ts": [
          "import type { Missing } from 'not-declared';",
          "export interface Fixture { value: Missing; }",
          "",
        ].join("\n"),
      },
    },
    {
      name: "rejects declarations that are shipped but unreachable",
      expectedStatus: 1,
      expectedStderr: "unreachable declarations would ship",
      files: {
        "lib/unreachable.d.ts": [
          "import type { DebouncedFunc } from 'lodash-es';",
          "export type Hidden = DebouncedFunc<() => void>;",
          "",
        ].join("\n"),
      },
    },
    {
      name: "rejects unresolved stylesheet assets",
      expectedStatus: 1,
      expectedStderr: "stylesheet urls do not resolve inside lib",
      files: {
        "lib/styles/index.css": ".fixture { mask: url('./missing.svg'); }\n",
      },
    },
    {
      name: "rejects missing export-map targets",
      expectedStatus: 1,
      expectedStderr: "package entry/export targets are missing",
      pkg: {
        exports: {
          ".": {
            types: "./lib/index.d.ts",
            import: "./lib/index.js",
          },
          "./styles/index.css": "./lib/styles/index.css",
          "./missing": "./lib/missing.js",
        },
      },
    },
  ];

  const failures = [];
  for (const testCase of cases) {
    const result = runFixture(testCase);
    const status = result.status ?? 1;
    if (status !== testCase.expectedStatus) {
      failures.push(
        [
          `${testCase.name}: expected exit ${testCase.expectedStatus}, got ${status}`,
          result.stderr,
        ].join("\n")
      );
      continue;
    }
    if (
      testCase.expectedStderr &&
      !result.stderr.includes(testCase.expectedStderr)
    ) {
      failures.push(
        [
          `${testCase.name}: stderr did not include ${JSON.stringify(
            testCase.expectedStderr
          )}`,
          result.stderr,
        ].join("\n")
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n\n"));
  }
  console.log(`check-publishable self-test: ${cases.length} passed`);
}

function parseArgs(args) {
  let packageRoot = defaultPackageRoot;
  let selfTest = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--self-test") {
      selfTest = true;
    } else if (arg === "--package-root") {
      const value = args[index + 1];
      if (!value) throw new Error("--package-root requires a path");
      packageRoot = resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { packageRoot, selfTest };
}

try {
  const { packageRoot, selfTest } = parseArgs(process.argv.slice(2));
  if (selfTest) {
    runSelfTest();
  } else {
    const { label, errors } = checkPublishable(packageRoot);
    if (errors.length > 0) {
      console.error(formatErrors(label, errors));
      process.exit(1);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
