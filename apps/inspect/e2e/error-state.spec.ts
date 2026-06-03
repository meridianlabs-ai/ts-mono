import { http, HttpResponse, delay } from "msw";

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
    const errorPanel = page.locator("[data-testid='error-panel']");
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
    const errorPanel = page.locator("[data-testid='error-panel']");
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
    await expect(page.locator(".ag-root")).toBeVisible({ timeout: 10_000 });
  });

  test("shows ActivityBar, Loading..., then ErrorPanel after a delayed 500", async ({
    page,
    network,
  }) => {
    network.use(
      // Provide a valid log root so initLogDir succeeds and the replication
      // path is entered. Without this, /api/logs fails with ECONNREFUSED and
      // the error arrives before the loading state is ever set.
      http.get("*/api/logs*", () => {
        return HttpResponse.json({ log_dir: "/home/test/logs" });
      }),

      // Slow 500 on the log-files endpoint so the loading indicators are
      // visible for long enough to be asserted.
      http.get("*/api/log-files*", async () => {
        await delay(1000);
        return HttpResponse.json(
          { error: "Internal Server Error" },
          { status: 500 }
        );
      })
    );

    await page.goto("/");

    // ActivityBar must animate while the request is in-flight.
    // The inner animated div is a child of [role='progressbar']; its presence
    // signals animating=true. toBeEmpty() only checks text content so we
    // target the child directly.
    const activityBarChild = page
      .locator("[role='progressbar']")
      .first()
      .locator("> div");
    await expect(activityBarChild).toBeVisible({ timeout: 5_000 });

    // Grid loading overlay should be visible while loading=1
    await expect(page.getByText("Loading")).toBeVisible();

    // After the delayed 500 resolves the error panel must appear
    await expect(page.locator("[data-testid='error-panel']")).toBeVisible({
      timeout: 10_000,
    });

    // And the ActivityBar must have stopped (child div gone)
    await expect(activityBarChild).not.toBeVisible({ timeout: 5_000 });
  });
});
