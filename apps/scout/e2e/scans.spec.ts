import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";

test("scans page shows an empty grid when no scans exist", async ({ page }) => {
  const listed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/v2/scans/")
  );
  await page.goto("/#/scans");
  await listed;

  // The only body row is the grid's empty-state message.
  const bodyRows = page.locator("tbody").getByRole("row");
  await expect(bodyRows).toHaveCount(1);
  await expect(bodyRows).toHaveText(/^No /);
  await expect(page.locator("#scan-job-footer")).toContainText("0 items");
});

test("scans page shows error panel on API failure", async ({
  page,
  network,
  disableRetries: _,
}) => {
  network.use(
    http.post("*/api/v2/scans/:dir", () =>
      HttpResponse.text("Internal Server Error", { status: 500 })
    )
  );

  await page.goto("/#/scans");

  await expect(page.getByText("Error Loading Scans")).toBeVisible();
});
