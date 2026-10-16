import type { NetworkFixture } from "@msw/playwright";
import { from } from "arquero";
import { http, HttpResponse } from "msw";

import { encodeBase64Url } from "@tsmono/util";

import type { Status } from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import { createStatus } from "./fixtures/test-data";

const SCAN_URL = `/#/scan/${encodeBase64Url("/home/test/project/.scans")}/scan_id=aBcDeFgHiJkLmNoPqRsTuV?scanner=regression`;

function mockRegressionScan(network: NetworkFixture): void {
  const rows = from([
    {
      uuid: "result-a",
      transcript_id: "transcript-a",
      value: 10,
      value_type: "number",
      explanation: "first result",
      metadata: "{}",
      transcript_metadata: "{}",
    },
    {
      uuid: "result-b",
      transcript_id: "transcript-b",
      value: 2,
      value_type: "number",
      explanation: "second result",
      metadata: "{}",
      transcript_metadata: "{}",
    },
  ]);
  network.use(
    http.get("*/api/v2/scans/:dir/:scanPath", () =>
      HttpResponse.json<Status>(
        createStatus({
          summary: {
            complete: true,
            scanners: {
              regression: {
                scans: 2,
                results: 2,
                tokens: 0,
                errors: 0,
                model_usage: {},
              },
            },
          },
        })
      )
    ),
    http.get("*/api/v2/scans/:dir/:scanPath/regression", () =>
      HttpResponse.arrayBuffer(Uint8Array.from(rows.toArrowIPC()).buffer)
    )
  );
}

test("scanner dataframe loads Arrow data, updates its footer, and opens the right result", async ({
  page,
  network,
}) => {
  mockRegressionScan(network);
  await page.goto(SCAN_URL);
  await page.getByRole("button", { name: /dataframe/ }).click();
  const grid = page.getByRole("grid", { name: "Scanner results" });
  await expect(
    grid.getByRole("gridcell", { name: "transcript-a", exact: true })
  ).toBeVisible();
  await expect(page.locator("#scanner-panel-footer")).toContainText(
    "2 results"
  );
  await page.getByRole("button", { name: "Filter value", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Filter value", exact: true })
    .first()
    .fill("2");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#scanner-panel-footer")).toContainText("1 result");
  await page.getByRole("button", { name: /Choose Columns/ }).click();
  await page.getByRole("checkbox", { name: "value", exact: true }).uncheck();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(
    grid.getByRole("columnheader", { name: "value", exact: true })
  ).toHaveCount(0);
  await expect(page.locator("#scanner-panel-footer")).toContainText("1 result");
  await expect(
    grid.getByRole("gridcell", { name: "transcript-a", exact: true })
  ).toHaveCount(0);
  await grid
    .getByRole("gridcell", { name: "transcript-b", exact: true })
    .dblclick();
  await expect(page).toHaveURL(/\/result-b\?/);
});

test("Cmd/Ctrl+Enter in the scanner results list opens the result in a new tab", async ({
  page,
  network,
}) => {
  mockRegressionScan(network);
  await page.goto(SCAN_URL);
  await expect(page.getByText("first result")).toBeVisible();

  const newTab = page.context().waitForEvent("page");
  await page.keyboard.press("ControlOrMeta+Enter");
  const opened = await newTab;

  expect(opened.url()).toMatch(
    /#\/scan\/[^/]+\/scan_id=aBcDeFgHiJkLmNoPqRsTuV\/result-a/
  );
  await opened.close();
});
