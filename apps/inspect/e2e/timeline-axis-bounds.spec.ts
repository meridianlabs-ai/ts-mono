import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";
import { serveEvalLog } from "./fixtures/serve-log";
import { createEvalLog, createEvalStats } from "./fixtures/test-data";

for (const start of [2 ** 57, -(2 ** 57), Infinity]) {
  test(`invalid connection timestamp ${start} shows an error and leaves navigation responsive`, async ({
    page,
    network,
  }) => {
    const log = createEvalLog();
    log.stats = createEvalStats({
      started_at: "",
      completed_at: "",
      connection_limit_history: [
        {
          model: log.eval.model,
          timestamp: start,
          old_limit: 1,
          new_limit: 2,
          reason: "rate_limit",
        },
        {
          model: log.eval.model,
          timestamp: start + 64,
          old_limit: 2,
          new_limit: 3,
          reason: "rate_limit",
        },
      ],
    });
    serveEvalLog(network, log, "invalid-timeline.json");
    if (!Number.isFinite(start)) {
      network.use(
        http.get(
          "*/api/logs/:file",
          () =>
            new HttpResponse(
              JSON.stringify(log).replaceAll(
                '"timestamp":null',
                '"timestamp":1e400'
              ),
              { headers: { "Content-Type": "application/json" } }
            )
        )
      );
    }
    await page.goto("/#/logs/invalid-timeline.json");
    await page.getByRole("tab", { name: "Timeline", exact: true }).click();
    await expect(page.getByText("Unable to display timeline")).toBeVisible();
    await expect(page.getByTestId("error-panel")).toContainText(
      "connection history contains an invalid or out-of-range timestamp"
    );
    await expect(page.getByTestId("error-panel")).not.toContainText(/\bat /);
    await page.getByRole("tab", { name: "Info", exact: true }).click();
    await expect(
      page.getByText("Unable to display timeline")
    ).not.toBeVisible();
  });
}

test("ordinary connection history still renders the axis and bands", async ({
  page,
  network,
}) => {
  const log = createEvalLog();
  const start = Date.parse("2025-01-15T10:00:00Z") / 1000;
  log.stats = createEvalStats({
    connection_limit_history: [
      {
        model: log.eval.model,
        timestamp: start,
        old_limit: 1,
        new_limit: 2,
        reason: "rate_limit",
      },
      {
        model: log.eval.model,
        timestamp: start + 64,
        old_limit: 2,
        new_limit: 3,
        reason: "rate_limit",
      },
    ],
  });
  serveEvalLog(network, log, "valid-timeline.json");
  await page.goto("/#/logs/valid-timeline.json");
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect(
    page.locator("svg text").filter({ hasText: "Connections" }).first()
  ).toBeVisible();
  await expect(
    page.locator("svg text").filter({ hasText: "Jan 15" }).first()
  ).toBeVisible();
  await expect(page.getByTestId("error-panel")).not.toBeVisible();
});

test("legacy stats without connection history still open the timeline", async ({
  page,
  network,
}) => {
  const log = createEvalLog();
  const { connection_limit_history: _history, ...legacyStats } =
    createEvalStats();
  serveEvalLog(network, log, "legacy-timeline.json");
  network.use(
    http.get("*/api/logs/:file", () =>
      HttpResponse.json({ ...log, stats: legacyStats })
    )
  );
  await page.goto("/#/logs/legacy-timeline.json");
  const tab = page.getByRole("tab", { name: "Timeline", exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("error-panel")).not.toBeVisible();
  await expect(page.getByText("History", { exact: true })).toBeVisible();
});

for (const history of ["history", [null], [{ timestamp: "123" }]]) {
  test(`malformed history ${JSON.stringify(history)} only disables the timeline`, async ({
    page,
    network,
  }) => {
    const log = createEvalLog();
    serveEvalLog(network, log, "malformed-timeline.json");
    network.use(
      http.get("*/api/logs/:file", () =>
        HttpResponse.json({
          ...log,
          stats: { ...log.stats, connection_limit_history: history },
        })
      )
    );
    await page.goto("/#/logs/malformed-timeline.json");
    await page.getByRole("tab", { name: "Timeline", exact: true }).click();
    await expect(page.getByText("Unable to display timeline")).toBeVisible();
    await expect(page.getByTestId("error-panel")).toContainText(
      "Invalid connection history"
    );
    await expect(page.getByTestId("error-panel")).not.toContainText(/\bat /);
    await page.getByRole("tab", { name: "Info", exact: true }).click();
    await expect(page.getByTestId("error-panel")).not.toBeVisible();
  });
}
