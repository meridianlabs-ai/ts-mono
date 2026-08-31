#!/usr/bin/env node
// Renders the markdown body for the sticky PR comment describing how this
// PR changes suppressions.json. Prints nothing when the ledger is
// unchanged. Usage: node suppressions-pr-delta.mjs <base.json> <head.json>
//
// suppressions-comment.yml runs this from the base branch with no
// dependency install (see the security model there), so it must stay
// node-builtins-only — sibling script imports included.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { diffLedgers, totals } from "./check-suppressions.mjs";

export const MARKER = "<!-- suppressions-delta -->";

const load = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
};

// Ledger text (file paths, rule names) can come from a fork PR; render it
// inert inside the table cell: no raw HTML, no `|` cell breaks, no newlines.
const cell = (value) =>
  `<code>${value
    .replace(/[\r\n]+/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")}</code>`;

// The comment body for a base -> head ledger change, or null if none.
// An undescribed-only change (a `-- reason` added or removed) renders too:
// otherwise such a ledger diff would produce nothing and the workflow
// would falsely reset the sticky comment to "no longer changes the ledger".
export const render = (base, head) => {
  const rows = diffLedgers(base, head);
  if (rows.length === 0) return null;

  const before = totals(base);
  const after = totals(head);
  const delta = after.count - before.count;
  const undescribedDelta = after.undescribed - before.undescribed;
  const needsAttention = delta > 0 || undescribedDelta > 0;
  const deltaCell = delta === 0 ? "±0" : `${delta}`;
  const heading =
    undescribedDelta > 0 && delta <= 0
      ? `⚠️ Reason-less suppressions grew: ${before.undescribed} → ${after.undescribed} (+${undescribedDelta}); total ${before.count} → ${after.count} (${deltaCell})`
      : delta > 0
        ? `⚠️ Suppression ledger grew: ${before.count} → ${after.count} (+${delta})`
        : `Suppression ledger changed: ${before.count} → ${after.count} (${deltaCell})`;

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
      return `| ${cell(file)} | ${cell(rule)} | ${changeCell}${reasonNote} |`;
    })
    .join("\n");

  const undescribedLine =
    before.undescribed === after.undescribed
      ? ""
      : `\nReason-less (baselined) suppressions: ${before.undescribed} → ${after.undescribed}\n`;

  const footer = needsAttention
    ? "\nEvery new suppression needs a `-- reason` in the comment and maintainer sign-off of this ledger diff — see CONTRIBUTING.md."
    : "";

  return `${MARKER}\n### ${heading}\n\n| File | Rule | Change |\n|---|---|---|\n${table}\n${undescribedLine}${footer}`;
};

const main = () => {
  const [basePath, headPath] = process.argv.slice(2);
  const body = render(load(basePath), load(headPath));
  if (body !== null) console.log(body);
};

// fileURLToPath, not URL.pathname: pathname percent-encodes spaces etc.,
// which would make this guard silently false on such checkouts.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
