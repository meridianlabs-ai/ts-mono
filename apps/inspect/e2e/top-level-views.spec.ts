/**
 * E2E tests for the three top-level views: Tasks, Folders (Logs), and Samples.
 *
 * Verifies that:
 * - The default route lands on the flat Tasks view
 * - The segmented control switches between all three views
 * - Folders groups logs by directory
 * - Route prefixes are preserved when navigating into a log and back
 */
import type { BrowserContext, Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/app";
import {
  columnHeader,
  gridCell,
  segmentLink,
  setupLogListHandlers,
} from "./fixtures/log-list-scenario";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalSample } from "./fixtures/test-data";

test.describe("Top-level views", () => {
  test("Samples view hides the Cost column until it is picked", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/#/samples");

    await expect(columnHeader(page, "Tokens")).toBeVisible();
    await expect(columnHeader(page, "Cost")).toHaveCount(0);

    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("checkbox", { name: "Cost" }).check();
    await expect(columnHeader(page, "Cost")).toBeVisible();
  });

  test("can switch between all three views", async ({ page, network }) => {
    setupLogListHandlers(network);
    await page.goto("/");

    // Start on Tasks (default)
    await expect(gridCell(page, "task-alpha")).toBeVisible();

    // Switch to Folders
    await segmentLink(page, "Folders").click();
    await expect(page).toHaveURL(/#\/logs/);
    await expect(gridCell(page, "subdir")).toBeVisible();

    // Switch to Samples
    await segmentLink(page, "Samples").click();
    await expect(page).toHaveURL(/#\/samples/);

    // Switch back to Tasks
    await segmentLink(page, "Tasks").click();
    await expect(page).toHaveURL(/#\/tasks/);
    await expect(gridCell(page, "task-alpha")).toBeVisible();
  });

  test("Tasks view preserves /tasks prefix when navigating into a log", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");

    // Click on a task to navigate into it
    await gridCell(page, "task-alpha").click();

    // URL should stay under /tasks/
    await page.waitForURL(/#\/tasks\//);
    expect(page.url()).toMatch(/#\/tasks\//);
  });

  test("Folders view preserves /logs prefix when navigating into a log", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/#/logs");

    // Wait for the grid to load — in Folders mode, file names include timestamps
    await expect(gridCell(page, "task-alpha")).toBeVisible();

    // Click on a task to navigate into it
    await gridCell(page, "task-alpha").click();

    // URL should stay under /logs/
    await page.waitForURL(/#\/logs\//);
    expect(page.url()).toMatch(/#\/logs\//);
  });

  test("the default route shows the flat Tasks view", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");

    // task-gamma lives in subdir/ but is listed flat, with no folder row.
    await expect(gridCell(page, "task-alpha")).toBeVisible();
    await expect(gridCell(page, "task-beta")).toBeVisible();
    await expect(gridCell(page, "task-gamma")).toBeVisible();
    await expect(gridCell(page, "subdir")).toHaveCount(0);
  });

  test("Folders view groups logs by folder", async ({ page, network }) => {
    setupLogListHandlers(network);
    await page.goto("/#/logs");

    await expect(gridCell(page, "subdir")).toBeVisible();
    await expect(gridCell(page, "task-alpha")).toBeVisible();
    await expect(gridCell(page, "task-beta")).toBeVisible();
    // task-gamma sits inside the subdir folder, not at the root.
    await expect(gridCell(page, "task-gamma")).toHaveCount(0);
  });
});

test.describe("Sorting", () => {
  // Text of the first data row (tbody is the grid's last rowgroup; the first
  // rendered row is the top of the sorted order).
  const firstRowText = (
    page: Parameters<Parameters<typeof test>[2]>[0]["page"]
  ) =>
    page
      .getByRole("grid")
      .getByRole("rowgroup")
      .last()
      .getByRole("row")
      .first()
      .textContent();

  test("the Task header cycles ascending, descending and back to unsorted", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await expect(gridCell(page, "task-alpha")).toBeVisible();

    const taskHeader = columnHeader(page, "Task");
    await expect(
      page.locator(
        '[role="columnheader"]:is([aria-sort="ascending"], [aria-sort="descending"])'
      )
    ).toHaveCount(0);
    await expect.poll(() => firstRowText(page)).toContain("task-alpha");

    await taskHeader.click();
    await expect(taskHeader).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(() => firstRowText(page)).toContain("task-alpha");

    await taskHeader.click();
    await expect(taskHeader).toHaveAttribute("aria-sort", "descending");
    await expect.poll(() => firstRowText(page)).toContain("task-gamma");

    await taskHeader.click();
    await expect(taskHeader).toHaveAttribute("aria-sort", "none");
    await expect.poll(() => firstRowText(page)).toContain("task-alpha");
  });

  test("a compact (rotated) score header shows the sort it toggles", async ({
    page,
    network,
  }) => {
    const logFile = "compact-scores.json";
    const score = (value: number) => ({ value, history: [] });
    const sample = (id: number, accuracy: number, quality: number) => ({
      ...createEvalSample({
        id,
        messages: [{ role: "user", content: `input ${id}`, source: "input" }],
      }),
      scores: { accuracy: score(accuracy), quality: score(quality) },
    });
    const evalScore = (name: string) => ({
      name,
      scorer: name,
      params: {},
      metrics: {},
    });
    serveEvalLog(
      network,
      {
        ...createEvalLog({
          samples: [sample(1, 0, 1), sample(2, 1, 0)],
          eval: {
            viewer: {
              scanner_result_view: {},
              task_samples_view: { name: "default", compact_scores: true },
            },
          },
        }),
        results: {
          completed_samples: 2,
          total_samples: 2,
          scores: [evalScore("accuracy"), evalScore("quality")],
        },
      },
      logFile
    );
    await page.goto(`/#/logs/${logFile}`);

    const accuracy = columnHeader(page, "accuracy");
    const quality = columnHeader(page, "quality");
    const arrows = "i.bi-arrow-up, i.bi-arrow-down";
    // Precondition: these are the rotated headers, not upright ones.
    await expect(accuracy.locator('[class*="rotatedLabel"]')).toHaveCount(1);
    await expect(accuracy.locator(arrows)).toHaveCount(0);

    await accuracy.getByText("accuracy", { exact: true }).click();
    await expect(accuracy).toHaveAttribute("aria-sort", "ascending");
    await expect(accuracy.locator("i.bi-arrow-up")).toHaveCount(1);

    await accuracy.getByText("accuracy", { exact: true }).click();
    await expect(accuracy).toHaveAttribute("aria-sort", "descending");
    await expect(accuracy.locator("i.bi-arrow-down")).toHaveCount(1);
    await expect(accuracy.locator("i.bi-arrow-up")).toHaveCount(0);

    // Sorting another column moves the arrow off this one.
    await quality.getByText("quality", { exact: true }).click();
    await expect(quality).toHaveAttribute("aria-sort", "ascending");
    await expect(quality.locator("i.bi-arrow-up")).toHaveCount(1);
    await expect(accuracy).toHaveAttribute("aria-sort", "none");
    await expect(accuracy.locator(arrows)).toHaveCount(0);

    // A multi-sort numbers each sorted column by its position.
    const sortOrder = '[class*="sortOrder"]';
    await expect(quality.locator(sortOrder)).toHaveCount(0);
    await accuracy
      .getByText("accuracy", { exact: true })
      .click({ modifiers: ["Shift"] });
    await expect(accuracy.locator("i.bi-arrow-up")).toHaveCount(1);
    await expect(accuracy.locator(sortOrder)).toHaveText("2");
    await expect(quality.locator(sortOrder)).toHaveText("1");
  });
});

test.describe("Filtering", () => {
  test("filtering the Task column narrows rows; Reset Filters clears", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await expect(gridCell(page, "task-alpha")).toBeVisible();
    await expect(gridCell(page, "task-beta")).toBeVisible();

    // Open the Task column's filter funnel (hover-revealed) and apply a
    // "contains task-alpha" filter. "contains" (not =) so the test is robust
    // to the Task cell rendering the full file name rather than the bare task
    // name.
    const taskHeader = columnHeader(page, "Task");
    await taskHeader.hover();
    await taskHeader
      .getByRole("button", { name: "Filter task", exact: true })
      .click();
    await page.locator("#task-op").selectOption("contains");
    await page.getByPlaceholder("Filter").fill("task-alpha");
    await page.getByRole("button", { name: "Apply" }).click();

    // Only the matching row remains.
    await expect(gridCell(page, "task-alpha")).toBeVisible();
    await expect(gridCell(page, "task-beta")).toHaveCount(0);

    // Reset Filters restores all rows.
    await page.getByRole("button", { name: "Reset Filters" }).click();
    await expect(gridCell(page, "task-beta")).toBeVisible();
  });
});

test.describe("Keyboard navigation", () => {
  test("arrows move the selection and Enter opens the row", async ({
    page,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await expect(gridCell(page, "task-alpha")).toBeVisible();

    await page.getByRole("grid").focus();
    const selectedRow = page.locator('[role="row"][aria-selected="true"]');

    // First ArrowDown selects the first row.
    await page.keyboard.press("ArrowDown");
    await expect(selectedRow).toHaveCount(1);
    const firstText = (await selectedRow.textContent()) ?? "";

    // ArrowDown again moves to a different row.
    await page.keyboard.press("ArrowDown");
    await expect(selectedRow).toHaveCount(1);
    await expect(selectedRow).not.toHaveText(firstText);

    // ArrowUp returns to the first row.
    await page.keyboard.press("ArrowUp");
    await expect(selectedRow).toHaveText(firstText);

    // Enter opens the selected row (navigates into it, under /tasks/).
    await page.keyboard.press("Enter");
    await page.waitForURL(/#\/tasks\/.+/);
    expect(page.url()).toMatch(/#\/tasks\/.+/);
  });
});

test.describe("Open in new tab", () => {
  // page.url() stays "about:blank" for a background tab opened by a native
  // link gesture, so read the location from inside the page (retrying while
  // its initial navigation tears down the execution context).
  const expectTabUrl = (tab: Page, url: RegExp) =>
    expect
      .poll(() => tab.evaluate(() => location.href).catch(() => ""))
      .toMatch(url);

  // Clicked away from the name cell: the whole row is the link, not just the
  // task text.
  const lastCellOf = (page: Page, rowText: string) =>
    page
      .getByRole("row")
      .filter({ hasText: rowText })
      .getByRole("gridcell")
      .last();

  test("cmd/ctrl-click on a log row opens it in a new tab", async ({
    page,
    context,
    network,
  }) => {
    setupLogListHandlers(network);
    // The host page's query (e.g. ?log_dir=) must survive into the new tab.
    await page.goto("/?keep=1");
    await expect(gridCell(page, "task-beta")).toBeVisible();
    const listUrl = page.url();

    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      lastCellOf(page, "task-beta").click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await expectTabUrl(newPage, /\?keep=1#\/tasks\/.*task-beta/);

    expect(page.url()).toBe(listUrl);
    await expect(
      page.locator('[role="row"][aria-selected="true"]')
    ).toContainText("task-beta");
    // Focus stays on the grid, so arrow keys keep working.
    await expect(page.getByRole("grid")).toBeFocused();
  });

  test("middle-click on a log row opens it in a new tab", async ({
    page,
    context,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await expect(gridCell(page, "task-beta")).toBeVisible();
    const listUrl = page.url();

    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      lastCellOf(page, "task-beta").click({ button: "middle" }),
    ]);
    await expectTabUrl(newPage, /#\/tasks\/.*task-beta/);
    expect(page.url()).toBe(listUrl);
  });

  test("cmd/ctrl-click on a sample row opens the sample in a new tab", async ({
    page,
    context,
    network,
  }) => {
    const logFile = "two-samples.json";
    const sample = (id: number) =>
      createEvalSample({
        id,
        messages: [{ role: "user", content: `input ${id}`, source: "input" }],
      });
    serveEvalLog(
      network,
      createEvalLog({ samples: [sample(1), sample(2)] }),
      logFile
    );
    await page.goto(`/?keep=1#/logs/${logFile}`);
    const sampleRow = page
      .getByRole("grid")
      .getByRole("rowgroup")
      .last()
      .getByRole("row")
      .filter({ hasText: "input 2" });
    await expect(sampleRow).toBeVisible();
    const listUrl = page.url();

    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      sampleRow.click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await expectTabUrl(
      newPage,
      /\?keep=1#\/logs\/two-samples\.json\/samples\/sample\/2\/1/
    );
    expect(page.url()).toBe(listUrl);
  });

  // Opens `link` with cmd/ctrl-click and checks the new tab's URL while the
  // current page stays where it was.
  const expectOpensInNewTab = async (
    page: Page,
    context: BrowserContext,
    link: Locator,
    url: RegExp
  ) => {
    const before = page.url();
    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      link.click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await expectTabUrl(newPage, url);
    expect(page.url()).toBe(before);
    await newPage.close();
  };

  const serveTwoSamples = (
    network: Parameters<typeof setupLogListHandlers>[0]
  ) => {
    const sample = (id: number) =>
      createEvalSample({
        id,
        messages: [{ role: "user", content: `input ${id}`, source: "input" }],
      });
    serveEvalLog(
      network,
      createEvalLog({ samples: [sample(1), sample(2)] }),
      "two-samples.json"
    );
  };

  test("the Tasks / Folders / Samples switcher opens views in a new tab", async ({
    page,
    context,
    network,
  }) => {
    setupLogListHandlers(network);
    await page.goto("/");
    await expect(gridCell(page, "task-alpha")).toBeVisible();

    const nav = page.getByRole("navigation");
    for (const [name, route] of [
      ["Tasks", /#\/tasks\/$/],
      ["Folders", /#\/logs\/$/],
      ["Samples", /#\/samples\/$/],
    ] as const) {
      await expect(nav.getByRole("link", { name })).toHaveAttribute(
        "href",
        route
      );
    }
    await expectOpensInNewTab(
      page,
      context,
      nav.getByRole("link", { name: "Folders" }),
      /#\/logs\/$/
    );
    // A plain click still switches in place.
    await nav.getByRole("link", { name: "Samples" }).click();
    await expect(page).toHaveURL(/#\/samples\//);
  });

  test("log tabs open in a new tab", async ({ page, context, network }) => {
    serveTwoSamples(network);
    await page.goto("/#/logs/two-samples.json");
    const infoTab = page.getByRole("tab", { name: "Info" });
    await expect(infoTab).toBeVisible();

    await expectOpensInNewTab(
      page,
      context,
      infoTab,
      /#\/logs\/two-samples\.json\/info$/
    );
    await infoTab.click();
    await expect(page).toHaveURL(/#\/logs\/two-samples\.json\/info$/);
  });

  test("sample tabs and prev/next open in a new tab", async ({
    page,
    context,
    network,
  }) => {
    serveTwoSamples(network);
    await page.goto("/#/logs/two-samples.json/samples/sample/1/1/transcript");
    const next = page.getByRole("link", { name: "Next sample" });
    await expect(next).toBeVisible();

    await expectOpensInNewTab(
      page,
      context,
      next,
      /#\/logs\/two-samples\.json\/samples\/sample\/2\/1\/transcript$/
    );
    await expectOpensInNewTab(
      page,
      context,
      page.getByRole("tab", { name: "Messages" }),
      /#\/logs\/two-samples\.json\/samples\/sample\/1\/1\/messages$/
    );
    // Plain clicks still navigate in place.
    await next.click();
    await expect(page).toHaveURL(/\/samples\/sample\/2\/1\/transcript$/);
  });

  test("sample links keep the route surface and the current view", async ({
    page,
    network,
  }) => {
    serveTwoSamples(network);
    // Under /tasks, links stay under /tasks and keep the sample tab.
    await page.goto("/#/tasks/two-samples.json/samples/sample/1/1/messages");
    await expect(
      page.getByRole("link", { name: "Next sample" })
    ).toHaveAttribute(
      "href",
      /#\/tasks\/two-samples\.json\/samples\/sample\/2\/1\/messages$/
    );
    await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
      "href",
      /#\/tasks\/two-samples\.json\/samples\/sample\/1\/1\/transcript$/
    );
    // In focus mode, next-sample stays in focus mode.
    await page.goto("/#/logs/two-samples.json/samples/sample/1/1/event");
    await expect(
      page.getByRole("link", { name: "Next sample" })
    ).toHaveAttribute(
      "href",
      /#\/logs\/two-samples\.json\/samples\/sample\/2\/1\/event$/
    );
  });
});

// Drag a column's resize separator by `dx` px.
async function dragResize(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  columnId: string,
  dx: number
) {
  const handle = page.getByLabel(`Resize ${columnId}`, { exact: true });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no resize handle for ${columnId}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 8 });
  await page.mouse.up();
}

test("dragging a column divider resizes without reordering columns", async ({
  page,
  network,
}) => {
  serveEvalLog(
    network,
    createEvalLog({
      samples: [1, 2].map((id) =>
        createEvalSample({
          id,
          messages: [{ role: "user", content: `input ${id}`, source: "input" }],
        })
      ),
    }),
    "resize.json"
  );
  await page.goto("/#/logs/resize.json");
  const id = columnHeader(page, "Id");
  await expect(id).toBeVisible();
  const headerOrder = () =>
    page
      .getByRole("columnheader")
      .evaluateAll((cells) => cells.map((c) => c.textContent.trim()));
  const width = async () => Math.round((await id.boundingBox())?.width ?? 0);
  const order = await headerOrder();
  const before = await width();

  // Resizing moves the divider off the press point, onto a draggable
  // header label — the column's own when widening, its neighbour's when
  // narrowing. The browser must not start a column drag from there.
  await dragResize(page, "sampleId", 60);
  expect(await headerOrder()).toEqual(order);
  const resized = await width();
  expect(resized).toBeGreaterThan(before + 40);
  const input = columnHeader(page, "Input");
  const inputBefore = (await input.boundingBox())?.width ?? 0;
  await dragResize(page, "input", -80);
  expect(await headerOrder()).toEqual(order);
  expect((await input.boundingBox())?.width ?? 0).toBeLessThan(
    inputBefore - 40
  );
  // The press still moves focus to the grid, so arrow keys keep working.
  await page.getByRole("textbox").first().focus();
  await dragResize(page, "input", 20);
  await expect(page.getByRole("grid")).toBeFocused();

  // With the button released, moving the pointer no longer resizes.
  const box = (await id.boundingBox())!;
  await page.mouse.move(box.x + 400, box.y + 200, { steps: 10 });
  await page.mouse.move(box.x + 10, box.y + 200, { steps: 10 });
  expect(await width()).toBe(resized);
});

test("a header drag that starts mid-resize is cancelled", async ({
  page,
  network,
}) => {
  serveEvalLog(
    network,
    createEvalLog({
      samples: [1, 2].map((id) =>
        createEvalSample({
          id,
          messages: [{ role: "user", content: `input ${id}`, source: "input" }],
        })
      ),
    }),
    "resize.json"
  );
  await page.goto("/#/logs/resize.json");
  const label = columnHeader(page, "Id").getByText("Id", { exact: true });
  await expect(label).toBeVisible();
  // A browser that ignores the divider's cancelled mousedown would start a
  // drag from the label under the press point; dispatch that dragstart.
  const box = (await page
    .getByLabel("Resize sampleId", { exact: true })
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 4 });
  const cancelledMidResize = await label.evaluate(
    (el) =>
      !el.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer(),
        })
      )
  );
  await page.mouse.up();
  expect(cancelledMidResize).toBe(true);

  // Once the resize ends, the label drags again.
  const cancelledAfter = await label.evaluate(
    (el) =>
      !el.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer(),
        })
      )
  );
  expect(cancelledAfter).toBe(false);
  await label.dispatchEvent("dragend");
});

test("a dragged column width survives navigating into a log and back", async ({
  page,
  network,
}) => {
  setupLogListHandlers(network);
  await page.goto("/");
  const header = page.locator(
    '[role="columnheader"]:has([aria-label="Resize task"])'
  );
  await expect(header).toBeVisible();
  const before = (await header.boundingBox())!.width;
  await dragResize(page, "task", 120);
  const resized = (await header.boundingBox())!.width;
  expect(resized).toBeGreaterThan(before + 60);

  // Into a log and back — the grid remounts on the same scope and should
  // re-read the persisted width from the store (in-memory within the session).
  await gridCell(page, "task-alpha").click();
  await expect(page).toHaveURL(/#\/tasks\/.+/);
  await page.goBack();

  await expect(header).toBeVisible();
  const restored = (await header.boundingBox())!.width;
  expect(Math.abs(restored - resized)).toBeLessThan(3);
});

test.describe("Compact scores", () => {
  test("toggling compact scores resets score column widths only", async ({
    page,
    network,
  }) => {
    const logFile = "compact-widths.json";
    // Same-length names, so both score columns share a default width.
    const scorers = ["alpha", "gamma"];
    const sample = (id: number) => ({
      ...createEvalSample({
        id,
        messages: [{ role: "user", content: `input ${id}`, source: "input" }],
      }),
      scores: Object.fromEntries(
        scorers.map((name) => [name, { value: id, history: [] }])
      ),
    });
    serveEvalLog(
      network,
      {
        ...createEvalLog({
          samples: [sample(1), sample(2)],
          eval: {
            viewer: {
              scanner_result_view: {},
              task_samples_view: { name: "default", compact_scores: true },
            },
          },
        }),
        results: {
          completed_samples: 2,
          total_samples: 2,
          scores: scorers.map((name) => ({
            name,
            scorer: name,
            params: {},
            metrics: {},
          })),
        },
      },
      logFile
    );
    await page.goto(`/#/logs/${logFile}`);

    const resized = columnHeader(page, "alpha");
    const untouched = columnHeader(page, "gamma");
    const tokens = columnHeader(page, "Tokens");
    const width = async (header: Locator) =>
      Math.round((await header.boundingBox())?.width ?? 0);
    const setCompact = async (on: boolean) => {
      const view = page.getByRole("button", { name: /^\W*View\W*$/ });
      await view.click();
      await page
        .getByRole("checkbox", { name: "Compact scores" })
        .setChecked(on);
      await view.click();
    };

    await expect(resized.locator('[class*="rotatedLabel"]')).toHaveCount(1);
    const compactDefault = await width(untouched);
    await dragResize(page, "score__alpha__alpha", 50);
    await expect
      .poll(() => width(resized))
      .toBeGreaterThan(compactDefault + 30);
    await dragResize(page, "tokens", 60);
    const tokensResized = await width(tokens);

    // A score width set in one mode doesn't carry into the other; other
    // columns keep theirs.
    await setCompact(false);
    await expect(resized.locator('[class*="rotatedLabel"]')).toHaveCount(0);
    const uprightDefault = await width(untouched);
    expect(uprightDefault).toBeGreaterThan(compactDefault);
    await expect.poll(() => width(resized)).toBe(uprightDefault);
    expect(await width(tokens)).toBe(tokensResized);

    await setCompact(true);
    await expect.poll(() => width(resized)).toBe(compactDefault);
    expect(await width(tokens)).toBe(tokensResized);
  });
});
