import { from } from "arquero";
import { http, HttpResponse } from "msw";

import { encodeBase64Url } from "@tsmono/util";

import type { Status } from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import { createStatus } from "./fixtures/test-data";

test("scanner dataframe loads Arrow data, updates its footer, and opens the right result", async ({
  page,
  network,
}) => {
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
  const dir = encodeBase64Url("/home/test/project/.scans");
  await page.goto(
    `/#/scan/${dir}/scan_id=aBcDeFgHiJkLmNoPqRsTuV?scanner=regression`
  );
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
  await expect(
    page.getByRole("button", { name: /Clear Filters/ })
  ).toBeVisible();
  await grid
    .getByRole("gridcell", { name: "transcript-b", exact: true })
    .dblclick();
  await expect(page).toHaveURL(/\/result-b\?/);
});
