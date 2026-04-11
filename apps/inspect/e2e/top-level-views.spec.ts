/**
 * E2E tests for the three top-level views: Tasks, Folders (Logs), and Samples.
 *
 * Verifies that:
 * - The default route lands on the Tasks view
 * - The segmented control switches between all three views
 * - Each view renders its expected content
 * - Route prefixes are preserved when navigating into a log and back
 */
import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
} from "./fixtures/test-data";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const LOG_DIR = "/home/test/logs";

const LOG_FILES = [
  {
    name: `${LOG_DIR}/2025-01-15T10-00-00_task-alpha_abc123.eval`,
    task: "task-alpha",
    task_id: "task-alpha",
  },
  {
    name: `${LOG_DIR}/2025-01-15T10-05-00_task-beta_def456.eval`,
    task: "task-beta",
    task_id: "task-beta",
  },
  {
    name: `${LOG_DIR}/subdir/2025-01-15T10-10-00_task-gamma_ghi789.eval`,
    task: "task-gamma",
    task_id: "task-gamma",
  },
];

const LOG_HEADERS = LOG_FILES.map((f, i) => ({
  eval_id: `eval-${i}`,
  run_id: `run-${i}`,
  task: f.task,
  task_id: f.task_id,
  task_version: 1,
  model: "claude-sonnet-4-5-20250929",
  status: "success",
  started_at: "2025-01-15T10:00:00Z",
  completed_at: "2025-01-15T10:05:00Z",
}));

function makeSampleLog(taskName: string) {
  const sample = createEvalSample({
    id: 1,
    epoch: 1,
    messages: [
      { role: "user", content: `Input for ${taskName}`, source: "input" },
      {
        role: "assistant",
        content: `Response for ${taskName}`,
        source: "generate",
      },
    ],
  });
  return createEvalLog({
    samples: [sample],
    eval: { task: taskName, task_id: taskName },
  });
}

// ---------------------------------------------------------------------------
// Shared setup: mock the API so the app boots with our test data
// ---------------------------------------------------------------------------

function setupHandlers(
  network: Parameters<Parameters<typeof test>[2]>[0]["network"]
) {
  network.use(
    // Override log-dir to use our test directory
    http.get("*/api/log-dir", () => {
      return HttpResponse.json({ log_dir: LOG_DIR });
    }),

    // Initial log listing (called by get_log_root on boot / navigation)
    http.get("*/api/logs", () => {
      return HttpResponse.json({
        log_dir: LOG_DIR,
        files: LOG_FILES,
      });
    }),

    http.get("*/api/log-files*", () => {
      return HttpResponse.json({
        files: LOG_FILES,
        response_type: "full",
      });
    }),

    http.get("*/api/log-headers*", () => {
      return HttpResponse.json(LOG_HEADERS);
    }),

    http.get("*/api/logs/:file", ({ params }) => {
      const file = decodeURIComponent(params.file as string);
      const match = LOG_FILES.find(
        (f) => f.name === file || file.endsWith(f.name)
      );
      const taskName = match?.task ?? "unknown";
      return HttpResponse.json(makeSampleLog(taskName));
    }),

    http.get("*/api/log-details/:file", ({ params }) => {
      const file = decodeURIComponent(params.file as string);
      const match = LOG_FILES.find(
        (f) => f.name === file || file.endsWith(f.name)
      );
      const taskName = match?.task ?? "unknown";
      const evalLog = makeSampleLog(taskName);
      return HttpResponse.json(createLogDetails(evalLog));
    })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Helper to click a segment button by name (avoids matching column headers)
function segmentButton(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  name: string
) {
  return page.getByRole("button", { name });
}

// Helper to find a cell in the grid's File Name column
function gridCell(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  text: string
) {
  return page.locator(".ag-cell").filter({ hasText: text }).first();
}

test.describe("Top-level views", () => {
  test("default route shows the Tasks view", async ({ page, network }) => {
    setupHandlers(network);
    await page.goto("/");

    // The Tasks segment should be visible
    await expect(segmentButton(page, "Tasks")).toBeVisible();

    // Should show task rows in a grid (flat list, no folder grouping)
    const grid = page.locator(".ag-root-wrapper");
    await expect(grid).toBeVisible();

    // Should show log file entries
    await expect(gridCell(page, "task-alpha")).toBeVisible();
    await expect(gridCell(page, "task-beta")).toBeVisible();
  });

  test("segmented control navigates to Folders view", async ({
    page,
    network,
  }) => {
    setupHandlers(network);
    await page.goto("/");

    // Click the Folders segment
    await segmentButton(page, "Folders").click();

    // URL should update to /logs
    await expect(page).toHaveURL(/#\/logs/);

    // Should show the grid with a "subdir" folder row
    await expect(gridCell(page, "subdir")).toBeVisible();
  });

  test("segmented control navigates to Samples view", async ({
    page,
    network,
  }) => {
    setupHandlers(network);
    await page.goto("/");

    // Click the Samples segment
    await segmentButton(page, "Samples").click();

    // URL should update to /samples
    await expect(page).toHaveURL(/#\/samples/);
  });

  test("can switch between all three views", async ({ page, network }) => {
    setupHandlers(network);
    await page.goto("/");

    // Start on Tasks (default)
    await expect(gridCell(page, "task-alpha")).toBeVisible();

    // Switch to Folders
    await segmentButton(page, "Folders").click();
    await expect(page).toHaveURL(/#\/logs/);

    // Switch to Samples
    await segmentButton(page, "Samples").click();
    await expect(page).toHaveURL(/#\/samples/);

    // Switch back to Tasks
    await segmentButton(page, "Tasks").click();
    await expect(page).toHaveURL(/#\/tasks/);
    await expect(gridCell(page, "task-alpha")).toBeVisible();
  });

  test("Tasks view preserves /tasks prefix when navigating into a log", async ({
    page,
    network,
  }) => {
    setupHandlers(network);
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
    setupHandlers(network);
    await page.goto("/#/logs");

    // Wait for the grid to load — in Folders mode, file names include timestamps
    await expect(gridCell(page, "task-alpha")).toBeVisible();

    // Click on a task to navigate into it
    await gridCell(page, "task-alpha").click();

    // URL should stay under /logs/
    await page.waitForURL(/#\/logs\//);
    expect(page.url()).toMatch(/#\/logs\//);
  });

  test("Tasks view does not show folder grouping", async ({
    page,
    network,
  }) => {
    setupHandlers(network);
    await page.goto("/");

    // All three tasks should be visible as flat rows
    await expect(gridCell(page, "task-alpha")).toBeVisible();
    await expect(gridCell(page, "task-beta")).toBeVisible();
    await expect(gridCell(page, "task-gamma")).toBeVisible();

    // "subdir" should NOT appear as a separate folder row
    // (task-gamma is in subdir/ but should show as a flat entry)
    const folderRows = page.locator(".ag-row").filter({ hasText: /^subdir$/ });
    await expect(folderRows).toHaveCount(0);
  });

  test("Folders view groups logs by folder", async ({ page, network }) => {
    setupHandlers(network);
    await page.goto("/#/logs");

    // Should show the subdir folder
    await expect(gridCell(page, "subdir")).toBeVisible();

    // The root-level tasks should be visible (file names contain task names)
    await expect(gridCell(page, "task-alpha")).toBeVisible();
    await expect(gridCell(page, "task-beta")).toBeVisible();
  });
});
