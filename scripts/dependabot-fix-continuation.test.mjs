import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { selectContinuation } from "./dependabot-fix-continuation.mjs";

const BOT = "marvin-bot";
const pr = (number, overrides = {}) => ({
  number,
  url: `https://example.test/pull/${number}`,
  isCrossRepository: false,
  author: { login: BOT },
  ...overrides,
});

test("selects the same-repo bot PR", () => {
  const r = selectContinuation(
    [{ branch: "dependabot-fix/a", prs: [pr(7)] }],
    BOT
  );
  assert.deepEqual(r.selected, {
    branch: "dependabot-fix/a",
    number: 7,
    url: pr(7).url,
  });
  assert.deepEqual(r.skipped, []);
});

test("never selects a fork PR, even on a matching branch name", () => {
  const r = selectContinuation(
    [{ branch: "dependabot-fix/a", prs: [pr(7, { isCrossRepository: true })] }],
    BOT
  );
  assert.equal(r.selected, null);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /fork/);
});

test("treats a missing isCrossRepository field as untrusted", () => {
  const r = selectContinuation(
    [
      {
        branch: "dependabot-fix/a",
        prs: [pr(7, { isCrossRepository: undefined })],
      },
    ],
    BOT
  );
  assert.equal(r.selected, null);
});

test("skips a same-repo PR by another author", () => {
  const r = selectContinuation(
    [
      {
        branch: "dependabot-fix/a",
        prs: [pr(7, { author: { login: "someone" } })],
      },
    ],
    BOT
  );
  assert.equal(r.selected, null);
  assert.match(r.skipped[0].reason, /authored by someone/);
});

test("skips a branch with no open PR", () => {
  const r = selectContinuation(
    [{ branch: "dependabot-fix/stale", prs: [] }],
    BOT
  );
  assert.equal(r.selected, null);
  assert.deepEqual(r.skipped, [
    { branch: "dependabot-fix/stale", reason: "no open PR" },
  ]);
});

test("a fork PR on the same branch name does not shadow the bot's PR", () => {
  const r = selectContinuation(
    [
      {
        branch: "dependabot-fix/a",
        prs: [pr(9, { isCrossRepository: true }), pr(8)],
      },
    ],
    BOT
  );
  assert.equal(r.selected.number, 8);
  assert.equal(r.skipped[0].number, 9);
});

test("with several eligible PRs, picks the oldest and reports the rest", () => {
  const r = selectContinuation(
    [
      { branch: "dependabot-fix/b", prs: [pr(12)] },
      { branch: "dependabot-fix/a", prs: [pr(5)] },
    ],
    BOT
  );
  assert.equal(r.selected.number, 5);
  assert.deepEqual(
    r.alsoEligible.map((e) => e.number),
    [12]
  );
});

// End-to-end: real git against a local bare origin, `gh` replaced by a shim
// that serves canned JSON. Exercises the ls-remote parsing, the
// checkout/merge, and the GITHUB_OUTPUT contract the workflow reads.
const SCRIPT = fileURLToPath(
  new URL("./dependabot-fix-continuation.mjs", import.meta.url)
);

const git = (cwd, ...args) => {
  const r = spawnSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.test",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd, encoding: "utf8" }
  );
  assert.equal(r.status, 0, `git ${args.join(" ")}\n${r.stderr}`);
  return r.stdout.trim();
};

const FAKE_GH = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "api" && args[1] === "user") {
  console.log(process.env.FAKE_GH_LOGIN);
} else if (args[0] === "pr" && args[1] === "list") {
  const head = args[args.indexOf("--head") + 1];
  const prs = JSON.parse(readFileSync(process.env.FAKE_GH_PRS, "utf8"));
  console.log(JSON.stringify(prs.filter((p) => p.headRefName === head)));
} else {
  console.error("fake gh: unexpected", args);
  process.exit(2);
}
`;

// Builds origin with main plus the given branches, and a clone on main.
// Each branch is { name, file, content }; main gets mainChange applied.
const fixture = (branches, mainChange) => {
  const root = mkdtempSync(join(tmpdir(), "dbf-"));
  const seed = join(root, "seed");
  git(root, "init", "-q", seed);
  writeFileSync(join(seed, "pnpm-workspace.yaml"), "overrides:\n  a: ^1\n");
  writeFileSync(join(seed, "other.txt"), "base\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "base");
  for (const b of branches) {
    git(seed, "checkout", "-qb", b.name);
    writeFileSync(join(seed, b.file), b.content);
    git(seed, "commit", "-qam", `branch ${b.name}`);
    git(seed, "checkout", "-q", "main");
  }
  if (mainChange) {
    writeFileSync(join(seed, mainChange.file), mainChange.content);
    git(seed, "commit", "-qam", "main moves on");
  }
  const origin = join(root, "origin.git");
  git(root, "clone", "-q", "--bare", seed, origin);
  const work = join(root, "work");
  git(root, "clone", "-q", origin, work);

  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  return { root, work, bin };
};

const runScript = ({ root, work, bin }, prs, login = BOT) => {
  const prsFile = join(root, "prs.json");
  writeFileSync(prsFile, JSON.stringify(prs));
  const output = join(root, "output.txt");
  writeFileSync(output, "");
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: work,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
      FAKE_GH_PRS: prsFile,
      FAKE_GH_LOGIN: login,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: "",
      DEFAULT_BRANCH: "main",
    },
  });
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/=(.*)/s).slice(0, 2))
  );
  return { ...r, outputs };
};

test("e2e: fork PR named dependabot-fix/* is skipped and nothing is checked out", (t) => {
  const fx = fixture([
    { name: "dependabot-fix/evil", file: "other.txt", content: "evil\n" },
  ]);
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runScript(fx, [
    {
      number: 3,
      url: "u",
      headRefName: "dependabot-fix/evil",
      isCrossRepository: true,
      author: { login: BOT },
    },
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.outputs.branch, "");
  assert.equal(r.outputs.merge_conflicts, "false");
  assert.match(
    r.stdout,
    /skipped `dependabot-fix\/evil` \(PR 3\): cross-repository/
  );
  assert.equal(git(fx.work, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(readFileSync(join(fx.work, "other.txt"), "utf8"), "base\n");
});

test("e2e: no dependabot-fix branches in origin needs no gh at all", (t) => {
  const fx = fixture([]);
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  rmSync(join(fx.bin, "gh"));
  const r = runScript(fx, []);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.outputs.branch, "");
  assert.match(r.stdout, /none: no `dependabot-fix\/\*` branch in origin/);
});

test("e2e: same-repo bot PR is checked out with main merged cleanly", (t) => {
  const fx = fixture(
    [
      {
        name: "dependabot-fix/batch",
        file: "pnpm-workspace.yaml",
        content: "overrides:\n  a: ^2\n",
      },
    ],
    { file: "other.txt", content: "main\n" }
  );
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runScript(fx, [
    {
      number: 4,
      url: "https://example.test/pull/4",
      headRefName: "dependabot-fix/batch",
      isCrossRepository: false,
      author: { login: BOT },
    },
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.outputs.branch, "dependabot-fix/batch");
  assert.equal(r.outputs.pr_number, "4");
  assert.equal(r.outputs.pr_url, "https://example.test/pull/4");
  assert.equal(r.outputs.merge_conflicts, "false");
  assert.equal(
    git(fx.work, "rev-parse", "--abbrev-ref", "HEAD"),
    "dependabot-fix/batch"
  );
  assert.equal(
    git(fx.work, "rev-parse", "--abbrev-ref", "@{upstream}"),
    "origin/dependabot-fix/batch"
  );
  assert.equal(readFileSync(join(fx.work, "other.txt"), "utf8"), "main\n");
  assert.equal(
    readFileSync(join(fx.work, "pnpm-workspace.yaml"), "utf8"),
    "overrides:\n  a: ^2\n"
  );
  assert.equal(git(fx.work, "status", "--porcelain"), "");
});

test("e2e: merge conflicts are reported and left in the worktree", (t) => {
  const fx = fixture(
    [
      {
        name: "dependabot-fix/batch",
        file: "pnpm-workspace.yaml",
        content: "overrides:\n  a: ^2\n",
      },
    ],
    { file: "pnpm-workspace.yaml", content: "overrides:\n  a: ^3\n" }
  );
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runScript(fx, [
    {
      number: 4,
      url: "u",
      headRefName: "dependabot-fix/batch",
      isCrossRepository: false,
      author: { login: BOT },
    },
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.outputs.branch, "dependabot-fix/batch");
  assert.equal(r.outputs.merge_conflicts, "true");
  assert.match(r.stdout, /CONFLICTS/);
  assert.match(
    readFileSync(join(fx.work, "pnpm-workspace.yaml"), "utf8"),
    /^<{7} /m
  );
});

test("e2e: a gh failure fails the script rather than falling back to a fresh branch", (t) => {
  const fx = fixture([
    { name: "dependabot-fix/batch", file: "other.txt", content: "x\n" },
  ]);
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  writeFileSync(join(fx.bin, "gh"), "#!/bin/sh\nexit 4\n", { mode: 0o755 });
  const r = runScript(fx, []);
  assert.notEqual(r.status, 0);
  assert.equal(r.outputs.branch, undefined);
});
