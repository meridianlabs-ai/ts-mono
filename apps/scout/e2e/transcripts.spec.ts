import { http, HttpResponse } from "msw";

import { isRecord } from "@tsmono/util";

import type { AppConfig, TranscriptsResponse } from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import {
  createAppConfig,
  createTranscriptInfo,
  createTranscriptsResponse,
} from "./fixtures/test-data";

test("transcripts page renders grid with data", async ({ page, network }) => {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(
        createTranscriptsResponse([
          createTranscriptInfo({
            transcript_id: "t-001",
            task_id: "my-task",
            model: "claude-3",
            success: true,
          }),
          createTranscriptInfo({
            transcript_id: "t-002",
            task_id: "other-task",
            model: "gpt-4",
            success: false,
          }),
        ])
      )
    )
  );

  await page.goto("/#/transcripts");

  // Grid renders with transcript data
  await expect(page.getByText("my-task").first()).toBeVisible();
  await expect(page.getByText("other-task").first()).toBeVisible();

  // Footer shows item count
  await expect(page.locator("#transcripts-footer")).toContainText("2 items");
});

test("the add-filter popover opens with its column picker focused", async ({
  page,
  network,
}) => {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(
        createTranscriptsResponse([
          createTranscriptInfo({ transcript_id: "t-001", task_id: "my-task" }),
        ])
      )
    )
  );

  await page.goto("/#/transcripts");
  await expect(page.getByText("my-task").first()).toBeVisible();

  await page.getByTitle("Add a new filter").click();
  const picker = page.getByRole("combobox").filter({
    has: page.getByRole("option", { name: "Select column..." }),
  });
  await expect(picker).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
});

test("transcripts page shows an empty grid when no transcripts exist", async ({
  page,
}) => {
  const listed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/v2/transcripts/")
  );
  await page.goto("/#/transcripts");
  await listed;

  // The only body row is the grid's empty-state message.
  const bodyRows = page.locator("tbody").getByRole("row");
  await expect(bodyRows).toHaveCount(1);
  await expect(bodyRows).toHaveText("No transcripts in this directory.");
  await expect(page.locator("#transcripts-footer")).toContainText("0 items");
});

test("transcripts page says when no transcripts directory is configured", async ({
  page,
  network,
}) => {
  network.use(
    http.get("*/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(createAppConfig({ transcripts: null }))
    )
  );

  await page.goto("/#/transcripts");

  await expect(page.locator("tbody").getByRole("row")).toHaveText(
    "No transcripts directory configured."
  );
});

test("transcripts page shows error panel on API failure", async ({
  page,
  network,
  disableRetries: _,
}) => {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.text("Internal Server Error", { status: 500 })
    )
  );

  await page.goto("/#/transcripts");

  await expect(page.getByText("Error Loading Transcript")).toBeVisible();
});

test("the grid's funnels and headers take Enter, and arrowing off them then Enter opens a row", async ({
  page,
  network,
}) => {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(
        createTranscriptsResponse([
          createTranscriptInfo({ transcript_id: "t-001", task_id: "alpha" }),
          createTranscriptInfo({ transcript_id: "t-002", task_id: "beta" }),
        ])
      )
    )
  );
  await page.goto("/#/transcripts");
  await expect(page.getByText("alpha").first()).toBeVisible();

  const funnel = page.getByRole("button", {
    name: "Filter task_id",
    exact: true,
  });
  await funnel.focus();
  await page.keyboard.press("Enter");
  const filterInput = page.getByPlaceholder("Filter");
  await expect(filterInput).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(filterInput).toBeHidden();
  await expect(funnel).toBeFocused();

  const sorted = page.waitForRequest((request) => {
    const body: unknown = request.postDataJSON();
    return isRecord(body) && JSON.stringify(body.order_by).includes("task_id");
  });
  await page.getByRole("button", { name: "Task ID", exact: true }).focus();
  await page.keyboard.press("Enter");
  await sorted;

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/transcripts\/[^/]+\/t-00[12]/);
});
