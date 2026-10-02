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

const state = extract(({ document, window }) => {
  const grid = document.querySelector('[role="grid"]');
  const rows = Array.from(grid?.querySelectorAll('[role="row"]') ?? []).filter(
    (row) => row.querySelector('[role="gridcell"]')
  );
  return {
    count: Number(
      document.querySelector('[aria-label="Visible rows"]')?.textContent
    ),
    total: Number(new URL(window.location.href).searchParams.get("rows") ?? 6),
    ids: rows.flatMap((row) =>
      Array.from(
        row.textContent.matchAll(/transcript-(\d{4})/g),
        (match) => match[1] ?? ""
      )
    ),
    error: document.body.innerText.includes("Unexpected Application Error!"),
    exportError: document.body.dataset.exportError ?? null,
    activationError: document.body.dataset.activationError ?? null,
    filterError: document.body.dataset.filterError ?? null,
    exportChecks: Number(document.body.dataset.exportChecks ?? 0),
    activationChecks: Number(document.body.dataset.activationChecks ?? 0),
    filterChecks: Number(document.body.dataset.filterChecks ?? 0),
  };
});
export const uniqueRows = always(
  () => new Set(state.current.ids).size === state.current.ids.length
);
export const validCount = always(
  () => state.current.count >= 0 && state.current.count <= state.current.total
);
export const noErrorBoundary = always(() => !state.current.error);
export const losslessExport = always(() => state.current.exportError === null);
export const correctRowActivation = always(
  () => state.current.activationError === null
);
export const correctNumericFilter = always(
  () => state.current.filterError === null
);

const copy = registerCustomAction("verifyExport", async (document, window) => {
  await new Promise((resolve) => window.setTimeout(resolve, 200));
  const grid = document.querySelector('[role="grid"]');
  if (!grid) return;
  const button = Array.from(document.querySelectorAll("button")).find(
    (button) => /Copy CSV|Copied/.test(button.textContent)
  );
  if (!button) return;
  const columns = Array.from(
    grid.querySelectorAll('[role="columnheader"][aria-label]'),
    (header) => header.getAttribute("aria-label") ?? ""
  );
  const visibleRows = Array.from(grid.querySelectorAll("[aria-rowindex]"));
  const count = Number(
    document.querySelector('[aria-label="Visible rows"]')?.textContent
  );
  button.click();
  await new Promise((resolve) => window.setTimeout(resolve, 150));
  const csv = await window.navigator.clipboard.readText();
  // Parse independently of the application serializer, including quoted newlines.
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && (character === "," || character === "\n")) {
      record.push(field);
      field = "";
      if (character === "\n") {
        records.push(record);
        record = [];
      }
    } else if (quoted || character !== "\r") {
      field += character;
    }
  }
  if (record.length || field) records.push([...record, field]);
  const headers = records.shift() ?? [];
  const fail = (message: string) => {
    document.body.dataset.exportError ??= message;
  };
  if (quoted) fail("CSV contains an unterminated quoted field");
  if (
    JSON.stringify([...headers].sort()) !== JSON.stringify([...columns].sort())
  )
    fail(`CSV columns differ from the grid: ${JSON.stringify(headers)}`);
  if (records.length !== count)
    fail(`CSV has ${records.length} rows; filtered footer reports ${count}`);
  const idColumn = headers.indexOf("transcript_id");
  const ids = records.map((row) => row[idColumn]);
  if (new Set(ids).size !== ids.length)
    fail("CSV contains duplicate transcripts");
  for (const row of records) {
    const id = row[idColumn];
    const match = /^transcript-(\d{4})$/.exec(id ?? "");
    if (!match) {
      fail(`Unexpected exported transcript: ${id}`);
      continue;
    }
    const index = Number(match[1]);
    const expected: Record<string, string> = {
      transcript_id: `transcript-${index.toString().padStart(4, "0")}`,
      value: String([10, 2, null, -4, 2, 100][index % 6]),
      explanation: String(
        [
          'Alpha, quoted "text"\nnext line',
          "beta",
          "",
          "ALPHA",
          null,
          "Long explanation ".repeat(100),
        ][index % 6]
      ),
      metadata: JSON.stringify({ index, tags: ["a", "b"] }),
      passed: String(index % 2 === 0),
    };
    for (const [columnIndex, header] of headers.entries()) {
      if (row[columnIndex] !== expected[header])
        fail(
          `CSV changes ${header} for ${id}: ${JSON.stringify(row[columnIndex])}`
        );
    }
  }
  for (const row of visibleRows) {
    const index = Number(row.getAttribute("aria-rowindex")) - 2;
    const transcript = /transcript-\d{4}/.exec(row.textContent)?.[0];
    if (transcript && records[index]?.[idColumn] !== transcript)
      fail(`CSV row ${index + 1} does not match displayed ${transcript}`);
  }
  document.body.dataset.exportChecks = String(
    Number(document.body.dataset.exportChecks ?? 0) + 1
  );
});
const activate = registerCustomAction(
  "verifyActivation",
  async (document, window, ordinal: number, keyboard: boolean) => {
    const rows = Array.from(document.querySelectorAll("[aria-rowindex]"));
    const row = rows[ordinal % rows.length];
    const id = /transcript-(\d{4})/.exec(row?.textContent ?? "")?.[1];
    const button = row?.querySelector("button");
    if (!row || !id || !button) return;
    if (keyboard) {
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    } else button.click();
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    const actual = document.querySelector(
      '[aria-label="Opened result"]'
    )?.textContent;
    if (actual !== `result-${Number(id)}`)
      document.body.dataset.activationError = `Activated transcript-${id}, opened ${actual}`;
    document.body.dataset.activationChecks = String(
      Number(document.body.dataset.activationChecks ?? 0) + 1
    );
  }
);
const recover = registerCustomAction(
  "recoverGrid",
  async (document, window) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    if (!document.querySelector('[role="grid"]'))
      buttons.find((button) => button.textContent === "Toggle grid")?.click();
    buttons
      .find((button) => button.textContent.includes("Clear Filters"))
      ?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
);
const filter = registerCustomAction(
  "verifyNumericFilter",
  async (document, window, operator: string, value: number) => {
    const clear = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent.includes("Clear Filters")
    );
    // A bare click() doesn't dismiss other columns' open filter popovers.
    clear?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    clear?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Filter value"]')
      ?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    const popover = document.getElementById("column-filter-value");
    if (!popover) return;
    const select = popover.querySelector<HTMLSelectElement>("#value-op");
    const input = popover.querySelector<HTMLInputElement>("#value-val");
    if (!select || !input) return;
    select.value = operator;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    // Use the native setter so React sees the same value transition as typing.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const apply = Array.from(popover.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply"
    );
    if (!apply) return;
    apply.click();
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    const total = Number(
      new URL(window.location.href).searchParams.get("rows") ?? 6
    );
    const expected = Array.from(
      { length: total },
      (_, index) => [10, 2, null, -4, 2, 100][index % 6]
    ).filter(
      (number) =>
        number != null &&
        (operator === ">"
          ? number > value
          : operator === "<"
            ? number < value
            : number === value)
    ).length;
    const actual = Number(
      document.querySelector('[aria-label="Visible rows"]')?.textContent
    );
    if (actual !== expected)
      document.body.dataset.filterError = `Filter ${operator} ${value}: expected ${expected} rows, saw ${actual}`;
    document.body.dataset.filterChecks = String(
      Number(document.body.dataset.filterChecks ?? 0) + 1
    );
  }
);
const exportActions = actions(() => [copy()]);
const activationActions = actions(() =>
  [0, 1, 3, 5].flatMap((index) => [
    activate(index, false),
    activate(index, true),
  ])
);
const recoveryActions = actions(() => [recover()]);
const filterActions = actions(() =>
  [">", "<", "="].flatMap((operator) =>
    [0, 2, 10, 100].map((value) => filter(operator, value))
  )
);
export const interactions = weighted([
  [3, exportActions],
  [3, activationActions],
  [6, clicks],
  [1, inputs],
  [1, scroll],
  [1, waitOnce],
  [1, recoveryActions],
  [2, filterActions],
]);
