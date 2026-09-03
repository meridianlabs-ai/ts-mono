#!/usr/bin/env node
// Gate for lint/type-check suppression comments. suppressions.json (the
// ledger) must exactly match the suppression comments in the code — any
// add, remove, or move fails CI until the ledger is regenerated, so every
// change shows up as a reviewable ledger diff in the PR.
//
// The `undescribed` count (suppressions lacking a `-- reason`) is a
// ratchet: --update refuses to increase any rule's repo-wide total, so new
// suppressions must carry a reason while the baselined reason-less ones
// burn down over time. The ratchet is per rule, not per file, so moving a
// file doesn't trip it. See CONTRIBUTING.md.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LEDGER_PATH = "suppressions.json";
const UPDATE_HINT = "run `pnpm suppressions:update`";

// scripts/ holds this gate (its source and tests mention the directives it
// scans for); types/generated.ts files are eslint-ignored generated code,
// so directives there would be inert anyway.
const EXCLUDED = [/^scripts\//, /(^|\/)types\/generated\.ts$/];

// A directive counts only when it opens a comment (`//` or `/*`), so the
// same text inside a string literal is ignored unless the string itself
// looks like a comment — an accepted false-positive window.
const DIRECTIVE_RE =
  /(?:\/\/|\/\*)\s*(?:(eslint-disable(?:-next-line|-line)?)(?![\w-])|(@ts-expect-error|@ts-ignore|@ts-nocheck)\b)([^\n]*)/g;

// eslint treats ` -- ` (whitespace-delimited) as the description separator.
const DESCRIPTION_SEP = /\s--(?:\s|$)/;

const stripBlockClose = (text) => text.split("*/")[0];

// Bare `eslint-disable` (no -line/-next-line) suppresses until eslint-enable
// or end of file. Key it distinguishably so swapping a line-scoped directive
// for the file-wide form is a ledger diff, not a count-neutral no-op.
const FILE_WIDE = " (file-wide)";

const parseEslintDirective = (directive, rest) => {
  const scope = directive === "eslint-disable" ? FILE_WIDE : "";
  const [rulesPart, ...descParts] = stripBlockClose(rest).split(DESCRIPTION_SEP);
  const rules = rulesPart
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const described = descParts.join(" ").trim().length > 0;
  return (rules.length ? rules : ["*"]).map((rule) => ({
    rule: rule + scope,
    described,
  }));
};

const parseTsDirective = (directive, rest) => {
  // Mirrors @typescript-eslint/ban-ts-comment: @ts-expect-error is fine
  // with a description (>= 3 chars); @ts-ignore/@ts-nocheck never are.
  const desc = stripBlockClose(rest)
    .replace(/^\s*(--|:)?\s*/, "")
    .trim();
  const described = directive === "@ts-expect-error" && desc.length >= 3;
  return [{ rule: directive, described }];
};

export const scanSource = (text) =>
  [...text.matchAll(DIRECTIVE_RE)].flatMap(
    ([, eslintDirective, tsDirective, rest]) =>
      eslintDirective
        ? parseEslintDirective(eslintDirective, rest)
        : parseTsDirective(tsDirective, rest),
  );

const tallyRules = (records) =>
  Object.fromEntries(
    [...Map.groupBy(records, (r) => r.rule)]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rule, group]) => {
        const undescribed = group.filter((r) => !r.described).length;
        return [
          rule,
          undescribed
            ? { count: group.length, undescribed }
            : { count: group.length },
        ];
      }),
  );

export const buildLedger = (perFile) =>
  Object.fromEntries(
    [...perFile]
      .filter(([, records]) => records.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, records]) => [file, tallyRules(records)]),
  );

const entryKey = (file, rule) => file + "\t" + rule;
const keyOf = (key) => key.split("\t").join(" — ");

// Ledger JSON reaching the delta renderer can come from a fork PR head
// (see suppressions-pr-delta.mjs), so tally values are untrusted: coerce
// them to finite numbers and tolerate malformed shapes here, or a crafted
// string count would ride `+` concatenation through totals() into the
// rendered comment, bypassing the cell() escaping. Trusted inputs (the
// committed ledger, the gate's own scan) are unaffected.
const obj = (value) =>
  typeof value === "object" && value !== null ? value : {};
const num = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const entries = (ledger) =>
  Object.entries(obj(ledger)).flatMap(([file, rules]) =>
    Object.entries(obj(rules)).map(([rule, tally]) => [
      entryKey(file, rule),
      {
        count: num(obj(tally).count),
        undescribed: num(obj(tally).undescribed),
      },
    ]),
  );

const NONE = { count: 0, undescribed: 0 };

// Every (file, rule) pair whose count or undescribed count differs between
// ledger and code — adding a `-- reason` must be recorded too, or a stale
// undescribed allowance would let the reason be deleted again unnoticed.
export const diffLedgers = (ledger, actual) => {
  const before = new Map(entries(ledger));
  const after = new Map(entries(actual));
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key,
      before: before.get(key) ?? NONE,
      after: after.get(key) ?? NONE,
    }))
    .filter(
      ({ before, after }) =>
        before.count !== after.count ||
        before.undescribed !== after.undescribed,
    );
};

// The ratchet ignores the file-wide suffix: scope is a per-entry property
// the ledger diff already surfaces, while the ratchet tracks the repo-wide
// reason-less total per rule — a line ↔ file-wide swap moves between keys
// without changing that total.
const baseRule = (rule) =>
  rule.endsWith(FILE_WIDE) ? rule.slice(0, -FILE_WIDE.length) : rule;

const undescribedByRule = (ledger) => {
  const byRule = new Map();
  for (const rules of Object.values(ledger))
    for (const [rule, tally] of Object.entries(rules)) {
      const key = baseRule(rule);
      byRule.set(key, (byRule.get(key) ?? 0) + (tally.undescribed ?? 0));
    }
  return byRule;
};

// Every rule whose repo-wide reason-less count grew. Summed across files so
// moving a file never trips the ratchet; a move still shows in the ledger
// diff via diffLedgers, and --update records it.
export const ratchetViolations = (ledger, actual) => {
  const before = undescribedByRule(ledger);
  return [...undescribedByRule(actual)]
    .map(([rule, after]) => ({ rule, before: before.get(rule) ?? 0, after }))
    .filter(({ before, after }) => after > before);
};

export const totals = (ledger) =>
  entries(ledger).reduce(
    (acc, [, { count, undescribed }]) => ({
      count: acc.count + count,
      undescribed: acc.undescribed + undescribed,
    }),
    { count: 0, undescribed: 0 },
  );

const listFiles = () =>
  execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "*.ts",
      "*.tsx",
      "*.js",
      "*.jsx",
      "*.mjs",
      "*.cjs",
    ],
    { encoding: "utf8" },
  )
    .split("\0")
    // Untracked, non-ignored files count too, so an update run before
    // `git add` sees newly authored code; unstaged deletions still present
    // in the index are skipped so ordinary edit-then-update workflows do
    // not fail opening them.
    .filter((f) => f && !EXCLUDED.some((re) => re.test(f)) && existsSync(f));

const scanRepo = () =>
  buildLedger(
    new Map(listFiles().map((f) => [f, scanSource(readFileSync(f, "utf8"))])),
  );

const readLedger = () =>
  existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, "utf8")) : {};

const summarize = (ledger) => {
  const { count, undescribed } = totals(ledger);
  return `${count} suppressions (${undescribed} without a \`-- reason\`) in ${Object.keys(ledger).length} files`;
};

const main = () => {
  // git ls-files scopes to cwd and LEDGER_PATH is relative — anchor both to
  // the repo root so invocation from a subdirectory can't scan or write a
  // partial ledger.
  process.chdir(
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim(),
  );

  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--update");
  if (unknown.length) {
    // A silently-ignored typo (e.g. --updat) would run check mode instead.
    console.error(
      `unknown argument(s): ${unknown.join(" ")} (expected --update)`,
    );
    process.exit(2);
  }
  const update = args.includes("--update");
  // No ledger yet: the first --update captures the baseline as-is.
  const bootstrap = !existsSync(LEDGER_PATH);
  const ledger = readLedger();
  const actual = scanRepo();

  const violations = update && bootstrap ? [] : ratchetViolations(ledger, actual);
  for (const { rule, before, after } of violations) {
    console.error(
      `UNDESCRIBED: ${rule} — ${after} suppression(s) without a \`-- reason\` repo-wide, ledger allows ${before}.` +
        ` New suppressions need a reason in the comment.`,
    );
  }

  if (update) {
    if (violations.length) {
      console.error(
        "refusing to record reason-less growth; fix the code or add a `-- reason` segment.",
      );
      process.exit(1);
    }
    if (bootstrap)
      // A missing ledger silently skips the ratchet above; say so, or
      // deleting the file becomes an invisible bypass.
      console.log("no existing ledger: baseline captured, ratchet not applied.");
    writeFileSync(LEDGER_PATH, JSON.stringify(actual, null, 2) + "\n");
    console.log(`${LEDGER_PATH} updated: ${summarize(actual)}.`);
    return;
  }

  const diffs = diffLedgers(ledger, actual);
  for (const { key, before, after } of diffs) {
    console.error(
      after.count > before.count
        ? `NEW: ${keyOf(key)} — ${after.count} in code, ${before.count} in ledger. Fix the code instead if at all possible;` +
            ` a genuinely unavoidable suppression needs a \`-- reason\` — then ${UPDATE_HINT} and get maintainer sign-off on the ledger diff.`
        : after.count < before.count
          ? `REMOVED: ${keyOf(key)} — ${after.count} in code, ${before.count} in ledger. ${UPDATE_HINT} to record the shrink.`
          : `REASONS: ${keyOf(key)} — ${after.undescribed} without a \`-- reason\` in code, ${before.undescribed} in ledger. ${UPDATE_HINT} to record it.`,
    );
  }

  if (diffs.length || violations.length) process.exit(1);
  console.log(`suppressions ledger matches: ${summarize(actual)}.`);
};

// fileURLToPath, not URL.pathname: pathname percent-encodes spaces etc.,
// which would make this guard silently false on such checkouts.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
