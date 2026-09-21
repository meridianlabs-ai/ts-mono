#!/usr/bin/env node
// Picks the dependabot-fix continuation branch (SKILL.md step 5): the
// still-open batch PR from a previous run that this run should extend
// instead of opening a second one. Checks it out and merges the default
// branch in. Prints "none" and leaves the checkout alone when there is
// nothing to continue.
//
// With `--select-only` (the scheduled workflow's gate job) it only selects:
// nothing is fetched or checked out, and the agent job checks out and
// merges the branch this script named. When nothing is continued, the
// `branch` output names a fresh `dependabot-fix/<date>` branch instead, so
// the workflow — never the agent — decides which branch a run lands on.
//
// SECURITY MODEL. The scheduled workflow runs this before the agent and
// then runs pnpm install / check / build / test on whatever is checked
// out, and pushes the agent's commits as the org's GitHub App. A
// head-branch-name match alone is not a safe selection rule: `gh pr list`
// reports fork PRs with the fork's branch name, so anyone could open a
// fork PR named dependabot-fix/<x> and have its tree executed here. A
// candidate must therefore be:
//   1. a branch that exists in THIS repository (`git ls-remote origin`) —
//      only write-access accounts can create one; fork branches never
//      appear there; and
//   2. the head of an open PR that is not cross-repository.
// Anyone who can satisfy both already has write access to the repo, so
// no author check is needed — and none is applied, so a human running
// the skill continues the bot's PR and vice versa (one batch PR across
// runs). Everything else is reported as skipped and never fetched or
// checked out.
//
// Node builtins only, like the other gate scripts: no install has run yet
// when the workflow calls this.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PREFIX = "dependabot-fix/";

const skipReason = (pr) =>
  pr.isCrossRepository === false
    ? null
    : "cross-repository (fork) PR — untrusted, never checked out";

// Pure selection over already-fetched data so the rule is unit-testable.
// candidates: [{ branch, prs: [{ number, url, isCrossRepository }] }]
export function selectContinuation(candidates) {
  const eligible = [];
  const skipped = [];
  for (const { branch, prs } of candidates) {
    if (prs.length === 0) skipped.push({ branch, reason: "no open PR" });
    for (const pr of prs) {
      const reason = skipReason(pr);
      if (reason) skipped.push({ branch, number: pr.number, reason });
      else eligible.push({ branch, number: pr.number, url: pr.url });
    }
  }
  eligible.sort((a, b) => a.number - b.number);
  const [selected = null, ...rest] = eligible;
  for (const e of rest) {
    skipped.push({
      branch: e.branch,
      number: e.number,
      reason: `also eligible; older PR ${selected.number} selected instead`,
    });
  }
  return { selected, skipped };
}

// Name for a new batch branch when nothing is continued: the run date, with
// a numeric suffix when that name is taken — a branch in origin (a batch
// merged or closed earlier the same day), so the land job never pushes onto
// a branch whose tip it did not start from, or the head name of any open PR
// (main() adds those, forks included), so the landing's open-or-adopt step
// finds no PR by that name but the one it opens.
export function newBatchBranch(taken, date = new Date()) {
  const base = `${PREFIX}${date.toISOString().slice(0, 10)}`;
  taken = new Set(taken);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

const run = (cmd, args, { allowExit = [0] } = {}) => {
  // argv arrays, never a shell: branch names are data even when trusted.
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (!allowExit.includes(result.status)) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${result.status}\n${result.stderr}`
    );
  }
  return result;
};

const listRemoteBranches = () => {
  const { stdout } = run("git", [
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${PREFIX}*`,
  ]);
  return stdout
    .split("\n")
    .map((line) => line.split("\t")[1])
    .filter((ref) => ref?.startsWith(`refs/heads/${PREFIX}`))
    .map((ref) => ref.slice("refs/heads/".length))
    .sort();
};

const listOpenPrs = (branch) => {
  const { stdout } = run("gh", [
    "pr",
    "list",
    "--state",
    "open",
    "--head",
    branch,
    "--limit",
    "50",
    "--json",
    "number,url,headRefName,isCrossRepository",
  ]);
  // --head matches by name across forks too; the caller filters on
  // isCrossRepository. Re-check the name so a gh quirk can't widen it.
  return JSON.parse(stdout).filter((pr) => pr.headRefName === branch);
};

// The merge commit needs an identity; CI has none configured. Don't
// override a developer's own identity on a local run.
const gitIdentityArgs = () => {
  const email = run("git", ["config", "user.email"], { allowExit: [0, 1] });
  if (email.stdout.trim()) return [];
  return [
    "-c",
    "user.name=dependabot-fix",
    "-c",
    "user.email=dependabot-fix@users.noreply.github.com",
  ];
};

const checkoutAndMerge = (branch, defaultBranch) => {
  run("git", ["fetch", "--no-tags", "origin", branch, defaultBranch]);
  run("git", ["checkout", "-B", branch, `origin/${branch}`]);
  const merge = run(
    "git",
    [...gitIdentityArgs(), "merge", "--no-edit", `origin/${defaultBranch}`],
    { allowExit: [0, 1] }
  );
  return merge.status === 1;
};

const emit = (outputs) => {
  if (!process.env.GITHUB_OUTPUT) return;
  const text = Object.entries(outputs)
    .map(([k, v]) => `${k}=${v}\n`)
    .join("");
  appendFileSync(process.env.GITHUB_OUTPUT, text);
};

const summarize = (lines) => {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
};

function main() {
  const selectOnly = process.argv.includes("--select-only");
  const defaultBranch = process.env.DEFAULT_BRANCH || "main";
  const lines = ["### dependabot-fix continuation"];

  const branches = listRemoteBranches();
  let selected = null;
  if (branches.length === 0) {
    lines.push(`- none: no \`${PREFIX}*\` branch in origin`);
  } else {
    const candidates = branches.map((branch) => ({
      branch,
      prs: listOpenPrs(branch),
    }));
    const result = selectContinuation(candidates);
    selected = result.selected;
    for (const s of result.skipped) {
      const pr = s.number === undefined ? "" : ` (PR ${s.number})`;
      lines.push(`- skipped \`${s.branch}\`${pr}: ${s.reason}`);
    }
    if (!selected) lines.push("- none: no eligible continuation PR");
  }

  let branch = selected?.branch;
  if (selected) {
    lines.push(
      `- continuing \`${selected.branch}\` (PR ${selected.number}, ${selected.url})`
    );
  } else {
    // A fresh name is not in origin, but a fork PR can carry any head
    // name; skip names an open PR uses so the landing cannot adopt it.
    const taken = [...branches];
    for (branch = newBatchBranch(taken); listOpenPrs(branch).length > 0;) {
      lines.push(
        `- skipped \`${branch}\`: an open PR already uses that head name`
      );
      taken.push(branch);
      branch = newBatchBranch(taken);
    }
    lines.push(`- new batch branch: \`${branch}\``);
  }
  const outputs = {
    branch,
    continuing: String(selected !== null),
    pr_number: selected?.number ?? "",
    pr_url: selected?.url ?? "",
  };

  if (selectOnly) {
    lines.push("- checkout deferred (--select-only)");
  } else {
    const conflicts = selected
      ? checkoutAndMerge(selected.branch, defaultBranch)
      : false;
    if (selected) {
      lines.push(
        `- merged \`${defaultBranch}\`: ${conflicts ? "CONFLICTS left in the worktree" : "clean"}`
      );
    }
    outputs.merge_conflicts = String(conflicts);
  }

  emit(outputs);
  summarize(lines);
}

// fileURLToPath, not URL.pathname: pathname percent-encodes spaces etc.,
// which would never equal argv[1] under such a checkout path.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
