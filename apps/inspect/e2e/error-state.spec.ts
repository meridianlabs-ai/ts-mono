/**
 * E2E tests for error state display in the grid views.
 *
 * Verifies that when the server returns a 500, the grid is replaced
 * with an ErrorPanel showing the error message.
 */
import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";

test.describe("Server error state", () => {
  test("shows ErrorPanel when /api/log-files returns 500", async ({
    page,
    network,
  }) => {
    network.use(
      http.get("*/api/log-files*", () => {
        return HttpResponse.json(
          { error: "Internal Server Error: database connection failed" },
          { status: 500 }
        );
      })
    );

    await page.goto("/");

    // The ErrorPanel should appear with the error message
    const errorPanel = page.locator("[class*='errorPanel']");
    await expect(errorPanel).toBeVisible({ timeout: 10_000 });

    // The AG Grid should NOT be visible
    const grid = page.locator(".ag-root");
    await expect(grid).not.toBeVisible();
  });

  test("clears error and shows grid on successful retry", async ({
    page,
    network,
  }) => {
    // First load: server error
    network.use(
      http.get("*/api/log-files*", () => {
        return HttpResponse.json(
          { error: "Internal Server Error" },
          { status: 500 }
        );
      })
    );

    await page.goto("/");
    const errorPanel = page.locator("[class*='errorPanel']");
    await expect(errorPanel).toBeVisible({ timeout: 10_000 });

    // Second load: restore default (empty success)
    network.use(
      http.get("*/api/log-files*", () => {
        return HttpResponse.json({ files: [], response_type: "full" });
      })
    );

    // Navigate away and back to trigger a fresh load
    await page.goto("/");
    await expect(errorPanel).not.toBeVisible({ timeout: 10_000 });
  });
});
