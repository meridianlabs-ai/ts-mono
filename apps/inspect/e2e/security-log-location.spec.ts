import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";
import { createEvalLog } from "./fixtures/test-data";

test.describe("untrusted log locations", () => {
  test("waits for approval before loading a query-selected log", async ({
    page,
    network,
  }) => {
    const target = "http://localhost:5175/remote/approved.json";
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url() === target) requests.push(request.url());
    });
    network.use(
      http.get("*/remote/approved.json", () =>
        HttpResponse.json(
          createEvalLog({
            eval: { task: "approved-task", task_id: "approved-task-id" },
          })
        )
      )
    );

    await page.goto(`/?log_file=${encodeURIComponent(target)}`);

    await expect(page.getByTestId("log-location-gate")).toBeVisible();
    expect(requests).toEqual([]);

    const approvedRequest = page.waitForRequest(target);
    await page.getByTestId("approve-log-location").click();
    await approvedRequest;

    await expect(page.getByTestId("log-location-gate")).toHaveCount(0);
    expect(requests).toEqual([target]);
  });

  test("blocks credential-bearing query locations", async ({ page }) => {
    const target = "http://user:secret@localhost:5175/remote/private.json";
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/remote/private.json")) {
        requests.push(request.url());
      }
    });

    await page.goto(`/?log_file=${encodeURIComponent(target)}`);

    await expect(page.getByTestId("log-location-gate")).toBeVisible();
    await expect(page.getByTestId("approve-log-location")).toHaveCount(0);
    await expect(
      page.getByText("Credential-bearing log URLs are not supported.")
    ).toBeVisible();
    expect(requests).toEqual([]);
  });

  test("gates an absolute hash route outside the configured root", async ({
    page,
    network,
  }) => {
    const target = "http://127.0.0.1:9/private.eval";
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http://127.0.0.1:9")) {
        requests.push(request.url());
      }
    });
    network.use(
      http.get("*/api/logs", () =>
        HttpResponse.json({ logs: [], log_dir: "/home/test/logs" })
      )
    );

    await page.goto(`/#/logs/${encodeURIComponent(target)}`);

    await expect(page.getByTestId("log-location-gate")).toBeVisible();
    expect(requests).toEqual([]);
  });

  test("turns browser postMessage updates into proposals", async ({
    page,
    network,
  }) => {
    const target = "http://127.0.0.1:9/private.eval";
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http://127.0.0.1:9")) {
        requests.push(request.url());
      }
    });
    network.use(
      http.get("*/api/logs", () =>
        HttpResponse.json({ logs: [], log_dir: "/home/test/logs" })
      )
    );
    await page.goto("/");
    await expect(page.getByText("Loading application…")).toHaveCount(0);

    await page.evaluate((url) => {
      window.postMessage({ type: "updateState", url }, "*");
    }, target);

    await expect(page.getByTestId("log-location-gate")).toBeVisible();
    expect(requests).toEqual([]);
  });

  test("keeps an embedded publisher log automatic", async ({
    page,
    network,
  }) => {
    const target = "http://localhost:5175/hosted/fixed.json";
    network.use(
      http.get("*/hosted/fixed.json", () =>
        HttpResponse.json(
          createEvalLog({
            eval: { task: "fixed-task", task_id: "fixed-task-id" },
          })
        )
      )
    );
    await page.route("http://localhost:5175/", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "</head>",
        `<script id="log_dir_context" type="application/json">${JSON.stringify({
          log_file: "hosted/fixed.json",
        })}</script></head>`
      );
      await route.fulfill({ response, body });
    });

    const logRequest = page.waitForRequest(target);
    await page.goto("/");
    await logRequest;
    await expect(page.getByTestId("log-location-gate")).toHaveCount(0);
  });
});
