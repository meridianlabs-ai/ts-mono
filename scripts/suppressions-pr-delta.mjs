#!/usr/bin/env node
// Renders the markdown body for the sticky PR comment describing how this
// PR changes suppressions.json. Prints nothing when the ledger is
// unchanged. Usage: node suppressions-pr-delta.mjs <base.json> <head.json>

import { readFileSync } from "node:fs";

const MARKER = "<!-- suppressions-delta -->";

const load = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
};

const flatten = (ledger) =>
  new Map(
    Object.entries(ledger).flatMap(([file, rules]) =>
      Object.entries(rules).map(([rule, tally]) => [
        `${file}\t${rule}`,
        { count: tally.count, undescribed: tally.undescribed ?? 0 },
      ]),
    ),
  );

const sum = (map, field) =>
  [...map.values()].reduce((acc, tally) => acc + tally[field], 0);

const [basePath, headPath] = process.argv.slice(2);
const base = flatten(load(basePath));
const head = flatten(load(headPath));

const NONE = { count: 0, undescribed: 0 };

// Undescribed-only changes count too (someone added/removed a `-- reason`):
// otherwise such a ledger diff would render nothing and the workflow would
// falsely reset the sticky comment to "no longer changes the ledger".
const rows = [...new Set([...base.keys(), ...head.keys()])]
  .map((key) => ({
    key,
    before: base.get(key) ?? NONE,
    after: head.get(key) ?? NONE,
  }))
  .filter(
    ({ before, after }) =>
      before.count !== after.count || before.undescribed !== after.undescribed,
  )
  .sort((a, b) => a.key.localeCompare(b.key));

if (rows.length === 0) process.exit(0);

const totalBefore = sum(base, "count");
const totalAfter = sum(head, "count");
const delta = totalAfter - totalBefore;
const heading =
  delta > 0
    ? `⚠️ Suppression ledger grew: ${totalBefore} → ${totalAfter} (+${delta})`
    : `Suppression ledger changed: ${totalBefore} → ${totalAfter} (${delta === 0 ? "±0" : delta})`;

const table = rows
  .map(({ key, before, after }) => {
    const [file, rule] = key.split("\t");
    const change = after.count - before.count;
    const changeCell =
      change === 0 ? "±0" : `${change > 0 ? "+" : ""}${change}`;
    const reasonNote =
      before.undescribed === after.undescribed
        ? ""
        : ` (reason-less ${before.undescribed} → ${after.undescribed})`;
    return `| \`${file}\` | \`${rule}\` | ${changeCell}${reasonNote} |`;
  })
  .join("\n");

const undescribedBefore = sum(base, "undescribed");
const undescribedAfter = sum(head, "undescribed");
const undescribedLine =
  undescribedBefore === undescribedAfter
    ? ""
    : `\nReason-less (baselined) suppressions: ${undescribedBefore} → ${undescribedAfter}\n`;

const footer =
  delta > 0
    ? "\nEvery new suppression needs a `-- reason` in the comment and maintainer sign-off of this ledger diff — see CONTRIBUTING.md."
    : "";

console.log(
  `${MARKER}\n### ${heading}\n\n| File | Rule | Change |\n|---|---|---|\n${table}\n${undescribedLine}${footer}`,
);
