/**
 * Shared three-task log-directory scenario for log-list e2e specs: two
 * top-level eval files plus one in a subdirectory, with MSW handlers serving
 * the listing, headers, and per-file logs, and locators for the log-list grid.
 */
import type { NetworkFixture } from "@msw/playwright";
import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";

import { expect } from "./app";
import { pathParam } from "./handlers";
import { createEvalLog, createEvalSample, createLogDetails } from "./test-data";

export const LOG_DIR = "/home/test/logs";

export const LOG_FILES = [
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

export const LOG_HEADERS = LOG_FILES.map((f, i) => ({
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

export function makeSampleLog(taskName: string) {
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

/** Mock the API so the app boots against the scenario's log directory. */
export function setupLogListHandlers(network: NetworkFixture) {
  network.use(
    http.get("*/api/log-dir", () => HttpResponse.json({ log_dir: LOG_DIR })),
    http.get("*/api/logs", () =>
      HttpResponse.json({ log_dir: LOG_DIR, files: LOG_FILES })
    ),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({ files: LOG_FILES, response_type: "full" })
    ),
    http.get("*/api/log-headers*", () => HttpResponse.json(LOG_HEADERS)),
    http.get("*/api/logs/:file", ({ params }) => {
      const file = decodeURIComponent(pathParam(params.file));
      const match = LOG_FILES.find(
        (f) => f.name === file || file.endsWith(f.name)
      );
      return HttpResponse.json(makeSampleLog(match?.task ?? "unknown"));
    }),
    http.get("*/api/log-details/:file", ({ params }) => {
      const file = decodeURIComponent(pathParam(params.file));
      const match = LOG_FILES.find(
        (f) => f.name === file || file.endsWith(f.name)
      );
      return HttpResponse.json(
        createLogDetails(makeSampleLog(match?.task ?? "unknown"))
      );
    }),
    // Log info (size/etag) — requested when opening a specific log.
    http.get("*/api/log-info/:file", () => HttpResponse.json({ size: 0 }))
  );
}

// Scoped to the navbar so it doesn't collide with the grid's per-column
// filter funnels (whose aria-labels like "Filter totalSamples" substring-match
// segment names like "Samples").
export function segmentButton(page: Page, name: string) {
  return page.getByRole("navigation").getByRole("button", { name });
}

export function gridCell(page: Page, text: string) {
  return page.getByRole("gridcell").filter({ hasText: text }).first();
}

export async function waitForGrid(page: Page) {
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(gridCell(page, "task-alpha")).toBeVisible();
}

// Find a column header by its exact label text. Matching by accessible name
// is unreliable because the (always-present) filter funnel button's aria-label
// bleeds into the header's accessible name; match the header text node instead.
export function columnHeader(page: Page, label: string) {
  return page
    .getByRole("columnheader")
    .filter({ has: page.getByText(label, { exact: true }) });
}
