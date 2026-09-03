#!/usr/bin/env node
// Picks the dependabot-fix continuation branch (SKILL.md step 5): the
// still-open batch PR from a previous run that this run should extend
// instead of opening a second one. Checks it out and merges the default
// branch in. Prints "none" and leaves the checkout alone when there is
// nothing to continue.
//
// SECURITY MODEL. The scheduled workflow runs this before the agent and
// then runs pnpm install / check / build / test on whatever is checked
// out, holding the org machine-account PAT. A head-branch-name match
// alone is not a safe selection rule: `gh pr list` reports fork PRs with
// the fork's branch name, so anyone could open a fork PR named
// dependabot-fix/<x> and have its tree executed here. A candidate must
// therefore be:
//   1. a branch that exists in THIS repository (`git ls-remote origin`) —
//      only write-access accounts can create one; fork branches never
//      appear there;
//   2. the head of an open PR that is not cross-repository; and
//   3. authored by the account running this script (the machine account
//      in CI), i.e. a PR a previous run opened.
// Everything else is reported as skipped and never fetched or checked out.
//
// Node builtins only, like the other gate scripts: no install has run yet
// when the workflow calls this.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PREFIX = "dependabot-fix/";

// Pure selection over already-fetched data so the rule is unit-testable.
// candidates: [{ branch, prs: [{ number, url, isCrossRepository, author }] }]
export function selectContinuation(candidates, botLogin) {
  const eligible = [];
  const skipped = [];
  for (const { branch, prs } of candidates) {
    if (prs.length === 0) {
      skipped.push({ branch, reason: "no open PR" });
      continue;
    }
    for (const pr of prs) {
      if (pr.isCrossRepository !== false) {
        skipped.push({
          branch,
          number: pr.number,
          reason: "cross-repository (fork) PR — untrusted, never checked out",
        });
      } else if (pr.author?.login !== botLogin) {
        skipped.push({
          branch,
          number: pr.number,
          reason: `authored by ${pr.author?.login ?? "unknown"}, not ${botLogin}`,
        });
      } else {
        eligible.push({ branch, number: pr.number, url: pr.url });
      }
    }
  }
  eligible.sort((a, b) => a.number - b.number);
  return {
    selected: eligible[0] ?? null,
    alsoEligible: eligible.slice(1),
    skipped,
  };
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
    "number,url,headRefName,isCrossRepository,author",
  ]);
  // --head matches by name across forks too; the caller filters on
  // isCrossRepository. Re-check the name so a gh quirk can't widen it.
  return JSON.parse(stdout).filter((pr) => pr.headRefName === branch);
};

const gitIdentityArgs = (login) => {
  const email = run("git", ["config", "user.email"], { allowExit: [0, 1] });
  if (email.stdout.trim()) return [];
  return [
    "-c",
    `user.name=${login}`,
    "-c",
    `user.email=${login}@users.noreply.github.com`,
  ];
};

const checkoutAndMerge = (branch, defaultBranch, login) => {
  run("git", ["fetch", "--no-tags", "origin", branch, defaultBranch]);
  run("git", ["checkout", "-B", branch, `origin/${branch}`]);
  const merge = run(
    "git",
    [
      ...gitIdentityArgs(login),
      "merge",
      "--no-edit",
      `origin/${defaultBranch}`,
    ],
    { allowExit: [0, 1] }
  );
  return merge.status === 1;
};

const emit = (name, value) => {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
};

const summarize = (lines) => {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
};

function main() {
  const defaultBranch = process.env.DEFAULT_BRANCH || "main";
  const branches = listRemoteBranches();
  const lines = ["### dependabot-fix continuation"];

  if (branches.length === 0) {
    emit("branch", "");
    emit("merge_conflicts", "false");
    summarize([...lines, `- none: no \`${PREFIX}*\` branch in origin`]);
    return;
  }

  const botLogin = run("gh", ["api", "user", "-q", ".login"]).stdout.trim();
  const candidates = branches.map((branch) => ({
    branch,
    prs: listOpenPrs(branch),
  }));
  const { selected, alsoEligible, skipped } = selectContinuation(
    candidates,
    botLogin
  );

  for (const s of skipped) {
    const pr = s.number === undefined ? "" : ` (PR ${s.number})`;
    lines.push(`- skipped \`${s.branch}\`${pr}: ${s.reason}`);
  }
  for (const e of alsoEligible) {
    lines.push(
      `- also eligible, not selected: \`${e.branch}\` (PR ${e.number})`
    );
  }

  if (!selected) {
    emit("branch", "");
    emit("merge_conflicts", "false");
    summarize([...lines, "- none: no eligible continuation PR"]);
    return;
  }

  const conflicts = checkoutAndMerge(selected.branch, defaultBranch, botLogin);
  emit("branch", selected.branch);
  emit("pr_number", String(selected.number));
  emit("pr_url", selected.url);
  emit("merge_conflicts", String(conflicts));
  summarize([
    ...lines,
    `- continuing \`${selected.branch}\` (PR ${selected.number}, ${selected.url})`,
    `- merged \`${defaultBranch}\`: ${conflicts ? "CONFLICTS left in the worktree" : "clean"}`,
  ]);
}

// fileURLToPath, not URL.pathname: pathname percent-encodes spaces etc.,
// which would never equal argv[1] under such a checkout path.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
