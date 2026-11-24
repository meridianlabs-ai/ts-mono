import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { build } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { copyDistToPythonRepo } from "../python-repo/index.js";

const PKG = "copy_test";
const ENV_KEY = `TSMONO_PYTHON_ROOT_${PKG.toUpperCase()}`;

let root, target;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "copy-plugin-"));
  writeFileSync(join(root, "pyproject.toml"), `name = "${PKG}"\n`);
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>'
  );
  writeFileSync(join(root, "main.js"), "window.a = 1;");
  target = join(root, `src/${PKG}/_view/dist`);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "viewer.txt"), "current viewer");
  process.env[ENV_KEY] = root;
});
afterEach(() => {
  delete process.env[ENV_KEY];
  rmSync(root, { recursive: true });
});

const buildWithCopy = (plugins = [], outDir = join(root, "dist")) =>
  build({
    root,
    configFile: false,
    logLevel: "silent",
    build: { outDir, minify: false },
    plugins: [...plugins, copyDistToPythonRepo(PKG)],
  });

const expectViewerUntouched = () => {
  expect(readdirSync(target)).toEqual(["viewer.txt"]);
  expect(readFileSync(join(target, "viewer.txt"), "utf8")).toBe(
    "current viewer"
  );
};

const fail = (hook) => ({
  name: "fail",
  [hook]() {
    throw new Error(`boom in ${hook}`);
  },
});

describe("copyDistToPythonRepo", () => {
  it.each([
    { hook: "transform", staleDist: true },
    { hook: "transform", staleDist: false },
    { hook: "writeBundle", staleDist: false },
  ])(
    "leaves the viewer untouched when $hook fails (stale dist: $staleDist)",
    async ({ hook, staleDist }) => {
      if (staleDist) {
        mkdirSync(join(root, "dist"));
        writeFileSync(join(root, "dist", "stale.txt"), "stale");
      }
      await expect(buildWithCopy([fail(hook)])).rejects.toThrow(
        `boom in ${hook}`
      );
      expectViewerUntouched();
    }
  );

  it("replaces the viewer with dist after a successful build", async () => {
    await buildWithCopy();
    expect(readdirSync(target).sort()).toEqual(["assets", "index.html"]);
  });

  it("keeps the build when Vite built straight into the viewer", async () => {
    await buildWithCopy([], target);
    expect(readdirSync(target)).toContain("index.html");
  });
});
