import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { contentSecurityPolicy, CSP_FILE } from "./index.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

/** Build `files` (index.html among them) with the policy plugin; return the
 *  policy file it wrote. */
const buildWithPolicy = async (files, directives) => {
  const root = mkdtempSync(join(tmpdir(), "csp-plugin-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: { outDir: "dist", minify: false },
    plugins: [contentSecurityPolicy(directives)],
  });
  return JSON.parse(readFileSync(join(root, "dist", CSP_FILE), "utf8"));
};

const sha256 = (code) =>
  `'sha256-${createHash("sha256").update(code).digest("base64")}'`;

const page = (body) =>
  `<!doctype html><html><head></head><body>${body}<script type="module" src="./main.js"></script></body></html>`;

describe("contentSecurityPolicy", () => {
  it("hashes each inline executable script into script-src after its first source", async () => {
    const policy = await buildWithPolicy(
      {
        "index.html": page(
          [
            "<script>window.a = 1;</script>",
            '<script data-src="x">window.b = 2;</script>',
            '<script type="application/json">{"log_dir": "logs"}</script>',
          ].join("")
        ),
        "main.js": "window.c = 3;",
      },
      {
        "default-src": ["'none'"],
        "script-src": ["'self'", "'wasm-unsafe-eval'"],
      }
    );

    expect(policy).toEqual({
      version: 1,
      directives: {
        "default-src": ["'none'"],
        "script-src": [
          "'self'",
          sha256("window.a = 1;"),
          sha256("window.b = 2;"),
          "'wasm-unsafe-eval'",
        ],
      },
    });
  });

  it("hashes a CRLF inline script as the browser does, with LF", async () => {
    const policy = await buildWithPolicy(
      {
        "index.html": page("<script>\r\nwindow.a = 1;\r\n</script>"),
        "main.js": "",
      },
      { "script-src": ["'self'"] }
    );

    expect(policy.directives["script-src"]).toEqual([
      "'self'",
      sha256("\nwindow.a = 1;\n"),
    ]);
  });

  it("fails the build when a shipped worker evaluates code", async () => {
    await expect(
      buildWithPolicy(
        {
          "index.html": page(""),
          "main.js":
            'new Worker(new URL("./worker.js", import.meta.url), { type: "module" });',
          "worker.js": 'self.f = new Function("return 1");',
        },
        { "script-src": ["'self'"] }
      )
    ).rejects.toThrow(/these scripts evaluate code: assets\/worker-.*\.js/);
  });

  it("allows evaluated code when script-src allows 'unsafe-eval'", async () => {
    await expect(
      buildWithPolicy(
        { "index.html": page(""), "main.js": 'window.f = eval("1");' },
        { "script-src": ["'self'", "'unsafe-eval'"] }
      )
    ).resolves.toMatchObject({ version: 1 });
  });

  it.each([
    [
      "a host-owned directive",
      { "frame-ancestors": ["'none'"] },
      /set by each host/,
    ],
    ["a source with a ;", { "img-src": ["'self';"] }, /can't go in a header/],
    [
      "a source with whitespace",
      { "img-src": ["'self' data:"] },
      /can't go in a header/,
    ],
  ])("rejects %s", async (_label, directives, message) => {
    await expect(
      buildWithPolicy(
        { "index.html": page(""), "main.js": "" },
        { "script-src": ["'self'"], ...directives }
      )
    ).rejects.toThrow(message);
  });
});
