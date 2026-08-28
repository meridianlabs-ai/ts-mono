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

const rows = [...new Set([...base.keys(), ...head.keys()])]
  .map((key) => ({
    key,
    before: base.get(key)?.count ?? 0,
    after: head.get(key)?.count ?? 0,
  }))
  .filter(({ before, after }) => before !== after)
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
    const change = after - before;
    return `| \`${file}\` | \`${rule}\` | ${change > 0 ? "+" : ""}${change} |`;
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
