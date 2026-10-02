import { always } from "@antithesishq/bombadil";
import {
  actions,
  extract,
  registerCustomAction,
  weighted,
} from "@antithesishq/bombadil/browser";
import {
  clicks,
  inputs,
  scroll,
  waitOnce,
} from "@antithesishq/bombadil/browser/defaults/actions";

export {
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults/properties";

const state = extract(({ document }) => {
  const grid = document.querySelector('[role="grid"]');
  const rows = Array.from(grid?.querySelectorAll('[role="row"]') ?? []).filter(
    (row) => row.querySelector('[role="gridcell"]')
  );
  return {
    count: Number(
      document.querySelector('[aria-label="Visible rows"]')?.textContent
    ),
    ids: rows.flatMap((row) =>
      Array.from(
        row.textContent.matchAll(/transcript-(\d{4})/g),
        (match) => match[1] ?? ""
      )
    ),
    error: document.body.innerText.includes("Unexpected Application Error!"),
    exportError: document.body.dataset.exportError ?? null,
  };
});
export const uniqueRows = always(
  () => new Set(state.current.ids).size === state.current.ids.length
);
export const validCount = always(
  () => state.current.count >= 0 && state.current.count <= 6
);
export const noErrorBoundary = always(() => !state.current.error);
export const losslessExport = always(() => state.current.exportError === null);

const copy = registerCustomAction("verifyExport", async (document, window) => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (button) => /Copy CSV|Copied/.test(button.textContent)
  );
  const hasLongRow = Array.from(
    document.querySelectorAll('[role="gridcell"]')
  ).some((cell) => cell.textContent === "transcript-0005");
  const hasExplanation = !!document.querySelector(
    '[role="columnheader"][aria-label="explanation"]'
  );
  if (!button || !hasLongRow || !hasExplanation) return;
  button.click();
  await new Promise((resolve) => window.setTimeout(resolve, 150));
  const csv = await window.navigator.clipboard.readText();
  if (!csv.includes("Long explanation ".repeat(100))) {
    document.body.dataset.exportError = `Long explanation missing or truncated in exported CSV (${csv.length} characters)`;
  }
});
const exportActions = actions(() => [copy()]);
export const interactions = weighted([
  [5, exportActions],
  [3, clicks],
  [1, inputs],
  [1, scroll],
  [1, waitOnce],
]);
