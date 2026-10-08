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
} from "@antithesishq/bombadil/browser/defaults/actions";

export {
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults/properties";

const state = extract(({ document }) => ({
  selectionError: document.body.dataset.selectionError ?? null,
  cancellationError: document.body.dataset.cancellationError ?? null,
  remountError: document.body.dataset.remountError ?? null,
  sortingError: document.body.dataset.sortingError ?? null,
  transactions: Number(document.body.dataset.transactions ?? 0),
  cancellations: Number(document.body.dataset.cancellations ?? 0),
  remounts: Number(document.body.dataset.remounts ?? 0),
}));
export const exactFilterMembership = always(
  () => state.current.selectionError === null
);
export const cancelPreservesResults = always(
  () => state.current.cancellationError === null
);
export const remountPreservesResults = always(
  () => state.current.remountError === null
);
export const numericSorting = always(() => state.current.sortingError === null);

const transaction = registerCustomAction(
  "filterTransaction",
  async (
    document,
    window,
    operator: string,
    threshold: number,
    mode: string,
    descending: boolean
  ) => {
    const pause = (ms = 80) =>
      new Promise((resolve) => window.setTimeout(resolve, ms));
    const button = (text: string) => {
      const found = Array.from(document.querySelectorAll("button")).find(
        (element) => element.textContent.includes(text)
      );
      if (!found) throw new Error(`Missing button: ${text}`);
      return found;
    };
    const select = async (id: string, value: string) => {
      const element = document.querySelector<HTMLSelectElement>(`#${id}`);
      if (!element) throw new Error(`Missing select: ${id}`);
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await pause();
    };
    const input = async (id: string, value: string) => {
      const element = document.querySelector<HTMLInputElement>(`#${id}`);
      if (!element) throw new Error(`Missing input: ${id}`);
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await pause();
    };
    const open = async (column: string) => {
      const trigger = document.querySelector<HTMLButtonElement>(
        `button[aria-label="Filter ${column}"]`
      );
      if (!trigger) throw new Error(`Missing filter: ${column}`);
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger.click();
      await pause();
    };
    const apply = async (column: string) => {
      const popover = document.getElementById(`column-filter-${column}`);
      const applyButton = Array.from(
        popover?.querySelectorAll("button") ?? []
      ).find((element) => element.textContent === "Apply");
      if (!applyButton) throw new Error(`Missing Apply for ${column}`);
      applyButton.click();
      await pause(150);
    };
    const readExport = async () => {
      const copy = Array.from(document.querySelectorAll("button")).find(
        (element) => /Copy CSV|Copied/.test(element.textContent)
      );
      if (!copy) throw new Error("Missing CSV control");
      copy.click();
      await pause(150);
      return window.navigator.clipboard.readText();
    };
    const increment = (key: string) => {
      document.body.dataset[key] = String(
        Number(document.body.dataset[key] ?? 0) + 1
      );
    };

    if (!document.querySelector('[role="grid"]')) {
      button("Toggle grid").click();
      await pause(150);
    }
    const clear = button("Clear Filters");
    clear.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    clear.click();
    await pause();
    await open("value");
    await select("value-op", operator);
    if (!operator.startsWith("is ")) {
      await input("value-val", String(threshold));
      if (operator === "between")
        await input("value-val2", String(threshold + 12));
    }
    if (mode === "and" || mode === "or") {
      const join = document.querySelector<HTMLInputElement>(
        `input[name="value-join"][value="${mode}"]`
      );
      if (!join) throw new Error("Missing compound-filter controls");
      join.click();
      await select("value-op-b", "=");
      await input("value-val-b", "2");
    }
    await apply("value");
    if (mode === "text") {
      await open("explanation");
      await select("explanation-op", "contains");
      await input("explanation-val", "ALPHA");
      await apply("explanation");
    }

    const header = document.querySelector(
      '[role="columnheader"][aria-label="value"]'
    );
    const direction = descending ? "descending" : "ascending";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (header?.getAttribute("aria-sort") === direction) break;
      header?.querySelector("button")?.click();
      await pause();
    }
    if (header?.getAttribute("aria-sort") !== direction)
      throw new Error(`Could not set ${direction} sort`);

    const csv = await readExport();
    // This fixture's transcript IDs contain no CSV metacharacters. Matching a
    // complete quoted field works even when users reorder the exported columns.
    const actual = Array.from(
      csv.matchAll(/(?:^|,)"transcript-(\d{4})"(?=,|\r?$)/gm),
      (match) => Number(match[1])
    );
    const total = Number(
      new URL(window.location.href).searchParams.get("rows") ?? 6
    );
    const valueAt = (index: number) => [10, 2, null, -4, 2, 100][index % 6];
    const matches = (number: number | null | undefined) => {
      if (operator === "is blank") return number == null;
      if (operator === "is not blank") return number != null;
      if (number == null) return false;
      switch (operator) {
        case "=":
          return number === threshold;
        case "!=":
          return number !== threshold;
        case "<":
          return number < threshold;
        case "<=":
          return number <= threshold;
        case ">":
          return number > threshold;
        case ">=":
          return number >= threshold;
        case "between":
          return number > threshold && number < threshold + 12;
        default:
          throw new Error(`Unknown numeric operator: ${operator}`);
      }
    };
    const expected = Array.from({ length: total }, (_, index) => index).filter(
      (index) => {
        const number = valueAt(index);
        const first = matches(number);
        if (mode === "and") return first && number === 2;
        if (mode === "or") return first || number === 2;
        if (mode === "text") return first && [0, 3].includes(index % 6);
        return first;
      }
    );
    const context = `${operator} ${threshold}, ${mode}, ${direction}`;
    if (
      JSON.stringify([...actual].sort((a, b) => a - b)) !==
      JSON.stringify(expected)
    )
      document.body.dataset.selectionError ??= `${context}: expected ${expected.join(",")}; got ${actual.join(",")}`;
    if (
      Number(
        document.querySelector('[aria-label="Visible rows"]')?.textContent
      ) !== expected.length
    )
      document.body.dataset.selectionError ??= `${context}: wrong footer count`;
    for (let index = 1; index < actual.length; index++) {
      const previous = valueAt(actual[index - 1] ?? -1) ?? -Infinity;
      const current = valueAt(actual[index] ?? -1) ?? -Infinity;
      if (descending ? previous < current : previous > current)
        document.body.dataset.sortingError ??= `${context}: ${previous} before ${current}`;
    }
    increment("transactions");

    if (mode === "cancel") {
      await open("value");
      await select("value-op", "=");
      await input("value-val", "999");
      document
        .querySelector("#value-op")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      await pause();
      if ((await readExport()) !== csv)
        document.body.dataset.cancellationError ??= context;
      increment("cancellations");
    }
    if (mode === "remount") {
      button("Toggle grid").click();
      await pause();
      button("Toggle grid").click();
      await pause(200);
      if ((await readExport()) !== csv)
        document.body.dataset.remountError ??= context;
      increment("remounts");
    }
  }
);
const transactions = actions(() =>
  [
    "=",
    "!=",
    "<",
    "<=",
    ">",
    ">=",
    "between",
    "is blank",
    "is not blank",
  ].flatMap((operator) =>
    [0, 2, 10, 100].flatMap((threshold) =>
      ["plain", "and", "or", "text", "cancel", "remount"].flatMap((mode) =>
        [false, true].map((descending) =>
          transaction(operator, threshold, mode, descending)
        )
      )
    )
  )
);
export const interactions = weighted([
  [5, transactions],
  [2, clicks],
  [1, inputs],
]);
