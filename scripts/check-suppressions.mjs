#!/usr/bin/env node
// Gate for lint/type-check suppression comments. suppressions.json (the
// ledger) must exactly match the suppression comments in the code — any
// add, remove, or move fails CI until the ledger is regenerated, so every
// change shows up as a reviewable ledger diff in the PR.
//
// The per-entry `undescribed` count (suppressions lacking a `-- reason`)
// is a ratchet: --update refuses to increase it, so new suppressions must
// carry a reason while the baselined reason-less ones burn down over time.
// See CONTRIBUTING.md.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

const parseEslintDirective = (rest) => {
  const [rulesPart, ...descParts] = stripBlockClose(rest).split(DESCRIPTION_SEP);
  const rules = rulesPart
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const described = descParts.join(" ").trim().length > 0;
  return (rules.length ? rules : ["*"]).map((rule) => ({ rule, described }));
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
        ? parseEslintDirective(rest)
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

const entries = (ledger) =>
  Object.entries(ledger).flatMap(([file, rules]) =>
    Object.entries(rules).map(([rule, tally]) => [
      entryKey(file, rule),
      { count: tally.count, undescribed: tally.undescribed ?? 0 },
    ]),
  );

// Every (file, rule) pair whose count differs between ledger and code.
export const diffLedgers = (ledger, actual) => {
  const before = new Map(entries(ledger));
  const after = new Map(entries(actual));
  return [...new Set([...before.keys(), ...after.keys()])]
    .map((key) => ({
      key,
      before: before.get(key)?.count ?? 0,
      after: after.get(key)?.count ?? 0,
    }))
    .filter(({ before, after }) => before !== after);
};

// Every (file, rule) pair where reason-less suppressions grew.
export const ratchetViolations = (ledger, actual) => {
  const before = new Map(entries(ledger));
  return entries(actual)
    .map(([key, { undescribed }]) => ({
      key,
      before: before.get(key)?.undescribed ?? 0,
      after: undescribed,
    }))
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
    ["ls-files", "-z", "--", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((f) => f && !EXCLUDED.some((re) => re.test(f)));

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
  const update = process.argv.includes("--update");
  // No ledger yet: the first --update captures the baseline as-is.
  const bootstrap = !existsSync(LEDGER_PATH);
  const ledger = readLedger();
  const actual = scanRepo();

  const violations = update && bootstrap ? [] : ratchetViolations(ledger, actual);
  for (const { key, before, after } of violations) {
    console.error(
      `UNDESCRIBED: ${keyOf(key)} — ${after} suppression(s) without a \`-- reason\`, ledger allows ${before}.` +
        ` New suppressions need a reason in the comment. If the file moved, rename its ledger entry by hand instead.`,
    );
  }

  if (update) {
    if (violations.length) process.exit(1);
    writeFileSync(LEDGER_PATH, JSON.stringify(actual, null, 2) + "\n");
    console.log(`${LEDGER_PATH} updated: ${summarize(actual)}.`);
    return;
  }

  const diffs = diffLedgers(ledger, actual);
  for (const { key, before, after } of diffs) {
    console.error(
      after > before
        ? `NEW: ${keyOf(key)} — ${after} in code, ${before} in ledger. Fix the code instead if at all possible;` +
            ` a genuinely unavoidable suppression needs a \`-- reason\` — then ${UPDATE_HINT} and get maintainer sign-off on the ledger diff.`
        : `REMOVED: ${keyOf(key)} — ${after} in code, ${before} in ledger. ${UPDATE_HINT} to record the shrink.`,
    );
  }

  if (diffs.length || violations.length) process.exit(1);
  console.log(`suppressions ledger matches: ${summarize(actual)}.`);
};

if (process.argv[1] === new URL(import.meta.url).pathname) main();
