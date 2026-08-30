/**
 * E2E tests for log-list filter / column-ordering scope behavior.
 *
 * Each scope (Tasks segment vs Folders segment, individual folders, etc.)
 * keeps its own filter+sort independently in the store. Switching scopes
 * shows that scope's own state; switching back restores what was there.
 *
 * Issue #136: Originally filed because Tasks and Folders shared a single
 * gridState slot — applying a sort in one bled into the other. Now each
 * scope has its own slot, so:
 *   - Tasks ↔ Folders round-trip preserves each side's state independently.
 *   - Drilling into a fresh subfolder shows a clean grid (that scope has
 *     no prior state).
 *
 * Issue #137: Navigating into a log and pressing back must PRESERVE the
 * filter and ordering on the task list (same scope round-trip).
 *
 * Tests drive the TanStack DataGrid via column-header sort clicks (sort
 * state shows as caret icons in the header) and via each column's filter
 * funnel popover.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/app";
import {
  columnHeader,
  gridCell,
  segmentButton,
  setupLogListHandlers,
} from "./fixtures/log-list-scenario";

// Find the "Task" column header (see columnHeader for why not by name).
function taskColumnHeader(page: Page) {
  return columnHeader(page, "Task");
}

function resetFiltersButton(page: Page) {
  return page.getByRole("button", { name: "Reset Filters" });
}

/**
 * Apply a "task contains <value>" filter through the Task column's filter
 * funnel (hover-revealed) popover. "contains" (not =) so tests are robust to
 * the Task cell rendering the full file name rather than the bare task name.
 */
async function applyTaskFilter(page: Page, value: string) {
  const header = taskColumnHeader(page);
  await header.hover();
  await header
    .getByRole("button", { name: "Filter task", exact: true })
    .click();
  await page.locator("#task-op").selectOption("contains");
  await page.getByPlaceholder("Filter").fill(value);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(resetFiltersButton(page)).toBeVisible();
}

async function waitForGrid(page: Page) {
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(gridCell(page, "task-alpha")).toBeVisible();
}

async function sortByTaskDesc(page: Page) {
  const header = taskColumnHeader(page);
  // Two clicks: asc, then desc.
  await header.click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await header.click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
}

async function expectSortedDesc(page: Page) {
  await expect(taskColumnHeader(page)).toHaveAttribute(
    "aria-sort",
    "descending"
  );
}

async function expectNoSort(page: Page) {
  await expect(taskColumnHeader(page)).toHaveAttribute("aria-sort", "none");
}

// ---------------------------------------------------------------------------
// Per-scope state — each scope (Tasks/Folders segment, each folder)
// keeps its filter+sort independently.
// ---------------------------------------------------------------------------

test.describe("Per-scope filter and ordering", () => {
  test("Tasks segment's sort doesn't leak into Folders segment", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await sortByTaskDesc(page);

    await segmentButton(page, "Folders").click();
    await expect(page).toHaveURL(/#\/logs/);
    await waitForGrid(page);
    // Folders has its own (empty) state — Tasks' sort doesn't bleed in.
    await expectNoSort(page);
  });

  test("Tasks segment's filter doesn't leak into Folders segment", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await applyTaskFilter(page, "alpha");

    await segmentButton(page, "Folders").click();
    await expect(page).toHaveURL(/#\/logs/);
    await waitForGrid(page);
    await expect(resetFiltersButton(page)).toBeHidden();
  });

  test("Tasks ↔ Folders round-trip restores Tasks' sort", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await sortByTaskDesc(page);

    await segmentButton(page, "Folders").click();
    await expect(page).toHaveURL(/#\/logs/);
    await waitForGrid(page);
    await expectNoSort(page);

    await segmentButton(page, "Tasks").click();
    await expect(page).toHaveURL(/#\/tasks/);
    await waitForGrid(page);
    // Tasks' sort is restored — independent of Folders' state.
    await expectSortedDesc(page);
  });

  test("Tasks ↔ Folders round-trip restores Tasks' filter", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await applyTaskFilter(page, "alpha");

    await segmentButton(page, "Folders").click();
    await expect(page).toHaveURL(/#\/logs/);
    await waitForGrid(page);
    await expect(resetFiltersButton(page)).toBeHidden();

    await segmentButton(page, "Tasks").click();
    await expect(page).toHaveURL(/#\/tasks/);
    await waitForGrid(page);
    await expect(resetFiltersButton(page)).toBeVisible();
  });

  test("Drilling into a fresh folder shows a clean grid", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/#/logs");
    await waitForGrid(page);

    await sortByTaskDesc(page);

    await gridCell(page, "subdir").click();
    await expect(page).toHaveURL(/#\/logs\/subdir/);
    await expect(gridCell(page, "task-gamma")).toBeVisible();
    // The subdir scope has no prior state — clean grid.
    await expectNoSort(page);
  });

  test("Each folder remembers its own filter independently", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/#/logs");
    await waitForGrid(page);

    // Apply filter at the root folder.
    await applyTaskFilter(page, "subdir");
    await expect(resetFiltersButton(page)).toBeVisible();

    // Drill into subdir — its own scope, no filter.
    await gridCell(page, "subdir").click();
    await expect(page).toHaveURL(/#\/logs\/subdir/);
    await expect(gridCell(page, "task-gamma")).toBeVisible();
    await expect(resetFiltersButton(page)).toBeHidden();
  });
});

test.describe("Tasks ↔ Samples round-trip preserves ordering", () => {
  // Samples is a different surface, not a different log-list scope. Like
  // going to a log and back, this round-trip should leave the task list's
  // sort untouched.
  test("Tasks → Samples → Tasks preserves column ordering", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await sortByTaskDesc(page);

    await segmentButton(page, "Samples").click();
    await expect(page).toHaveURL(/#\/samples/);

    await segmentButton(page, "Tasks").click();
    await expect(page).toHaveURL(/#\/tasks/);
    await waitForGrid(page);
    await expectSortedDesc(page);
  });
});

// ---------------------------------------------------------------------------
// Issue #137 — navigating into a log and back MUST preserve ordering
// ---------------------------------------------------------------------------

test.describe("#137 – Back from a log preserves ordering", () => {
  test("Tasks → log → back preserves column ordering", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await sortByTaskDesc(page);

    await gridCell(page, "task-alpha").click();
    await page.waitForURL(/#\/tasks\/.+\.eval/);

    await page.goBack();
    // goto("/") landed on the index route — back returns to that bare URL
    // (no /#/tasks suffix). Wait until it looks like the task list again.
    await waitForGrid(page);
    await expectSortedDesc(page);
  });

  test("Folders → log → back preserves column ordering", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/#/logs");
    await waitForGrid(page);

    await sortByTaskDesc(page);

    await gridCell(page, "task-alpha").click();
    await page.waitForURL(/#\/logs\/.+\.eval/);

    await page.goBack();
    await page.waitForURL(/#\/logs\/?$/);
    await waitForGrid(page);
    await expectSortedDesc(page);
  });

  test("Tasks → log → back preserves filter", async ({ page, network }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await applyTaskFilter(page, "alpha");

    await gridCell(page, "task-alpha").click();
    await page.waitForURL(/#\/tasks\/.+\.eval/);

    await page.goBack();
    await waitForGrid(page);
    await expect(resetFiltersButton(page)).toBeVisible();
  });

  test("Folders → log → back preserves filter", async ({ page, network }) => {
    setupLogListHandlers(network);
    await page.goto("/#/logs");
    await waitForGrid(page);

    await applyTaskFilter(page, "alpha");

    await gridCell(page, "task-alpha").click();
    await page.waitForURL(/#\/logs\/.+\.eval/);

    await page.goBack();
    await page.waitForURL(/#\/logs\/?$/);
    await waitForGrid(page);
    await expect(resetFiltersButton(page)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Regression — adjacent behaviors that must keep working both before and
// after the fix.
// ---------------------------------------------------------------------------

test.describe("Regression — adjacent behaviors", () => {
  test("Sort indicator appears after clicking a column header", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    const header = taskColumnHeader(page);
    await header.click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
  });

  test("Cycling sort to none removes the indicator", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    const header = taskColumnHeader(page);
    await header.click(); // asc
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await header.click(); // desc
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await header.click(); // none
    await expectNoSort(page);
  });

  test("Sorted column still navigates into a log on row click", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await waitForGrid(page);

    await sortByTaskDesc(page);

    await gridCell(page, "task-alpha").click();
    await page.waitForURL(/#\/tasks\/.+\.eval/);
  });
});
