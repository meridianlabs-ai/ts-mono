import { http, HttpResponse } from "msw";

import { expect, test } from "./fixtures/app";
import { createEvalLog } from "./fixtures/test-data";

declare global {
  interface Window {
    __LOG_SELECTION_FETCHES__?: string[];
  }
}

test.describe("URL-selected log loading", () => {
  for (const target of [
    "http://127.0.0.1:9/run.json",
    "http://10.0.0.1/run.json",
    "http://169.254.169.254/run.json",
    "https://logs.example.invalid/run.json",
  ]) {
    test(`does not request ${target} before approval`, async ({ page }) => {
      const targetRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().startsWith(new URL(target).origin)) {
          targetRequests.push(request.url());
        }
      });

      await page.goto(`/?log_file=${encodeURIComponent(target)}`);

      await expect(page.getByTestId("log-location-gate")).toBeVisible();
      await expect(
        page.getByText(new URL(target).origin, { exact: true })
      ).toBeVisible();
      expect(targetRequests).toEqual([]);
    });
  }

  test("does not request a same-origin API target before approval", async ({
    page,
  }) => {
    const target =
      "http://localhost:5174/api/log-delete/attacker-selected.eval";
    const targetRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url() === target) {
        targetRequests.push(request.url());
      }
    });

    await page.goto(`/?log_file=${encodeURIComponent(target)}`);

    await expect(page.getByTestId("log-location-gate")).toBeVisible();
    expect(targetRequests).toEqual([]);
  });

  for (const target of [
    "file:///tmp/run.eval",
    "data:application/json,{}",
    "blob:https://viewer.example/id",
    "command:run.eval",
    "vscode://file/run.eval",
  ]) {
    test(`blocks unsupported location ${target} without calling fetch`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        window.__LOG_SELECTION_FETCHES__ = [];
        window.fetch = (input, init) => {
          window.__LOG_SELECTION_FETCHES__?.push(String(input));
          return originalFetch(input, init);
        };
      });

      await page.goto(`/?log_file=${encodeURIComponent(target)}`);

      await expect(page.getByTestId("log-location-gate")).toBeVisible();
      await expect(page.getByText(target)).toBeVisible();
      await expect(page.getByTestId("approve-log-location")).toHaveCount(0);
      expect(
        await page.evaluate(() => window.__LOG_SELECTION_FETCHES__)
      ).toEqual([]);
    });
  }

  test("loads only the exact approved file after the action", async ({
    page,
    network,
  }) => {
    const target =
      "http://localhost:5174/remote/approved-run.json?token=current";
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/remote/")) {
        requests.push(request.url());
      }
    });
    network.use(
      http.get("*/remote/approved-run.json", () =>
        HttpResponse.json(
          createEvalLog({
            eval: {
              task: "approved-task",
              task_id: "approved-task-id",
            },
          })
        )
      )
    );

    await page.goto(`/?log_file=${encodeURIComponent(target)}`);
    expect(requests).toEqual([]);

    await page.getByTestId("approve-log-location").click();

    await expect(page.locator("#task-title")).toHaveText("approved-task", {
      timeout: 10_000,
    });
    expect(requests.length).toBeGreaterThan(0);
    expect(new Set(requests)).toEqual(new Set([target]));
  });

  test("does not follow an approved log redirect to another target", async ({
    page,
    network,
  }) => {
    const target = "http://localhost:5174/remote/redirect.json";
    const redirectedRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http://127.0.0.1:9")) {
        redirectedRequests.push(request.url());
      }
    });
    network.use(
      http.get("*/remote/redirect.json", () =>
        HttpResponse.redirect("http://127.0.0.1:9/private.json", 302)
      )
    );

    await page.goto(`/?log_file=${encodeURIComponent(target)}`);
    const initialRequest = page.waitForRequest(target);
    await page.getByTestId("approve-log-location").click();
    await initialRequest;
    await page.waitForTimeout(100);

    expect(redirectedRequests).toEqual([]);
  });

  test("does not fetch a query-selected directory before approval", async ({
    page,
    network,
  }) => {
    const listingRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/remote-logs/")) {
        listingRequests.push(request.url());
      }
    });
    network.use(
      http.get("*/remote-logs/listing.json", () => HttpResponse.json({})),
      http.get(
        "*/remote-logs/eval-set.json",
        () => new HttpResponse(null, { status: 404 })
      ),
      http.get(
        "*/remote-logs/flow.yaml",
        () => new HttpResponse(null, { status: 404 })
      )
    );

    await page.goto(
      `/?inspect_server=true&log_dir=${encodeURIComponent(
        "http://localhost:5174/remote-logs"
      )}`
    );

    await expect(page.getByTestId("log-location-gate")).toBeVisible();
    expect(listingRequests).toEqual([]);

    await page.getByTestId("approve-log-location").click();
    await expect(page.locator(".ag-root")).toBeVisible({ timeout: 10_000 });
    expect(listingRequests).toContain(
      "http://localhost:5174/remote-logs/listing.json"
    );
    expect(
      listingRequests.every((url) =>
        url.startsWith("http://localhost:5174/remote-logs/")
      )
    ).toBe(true);
  });

  test("keeps bundled hash selection automatic within the embedded root", async ({
    page,
    network,
  }) => {
    const logRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/logs/")) {
        logRequests.push(request.url());
      }
    });
    network.use(
      http.get("*/logs/listing.json", () =>
        HttpResponse.json({
          "bundled.json": {
            task: "bundled-task",
            task_id: "bundled-task-id",
          },
        })
      ),
      http.get("*/logs/bundled.json", () =>
        HttpResponse.json(
          createEvalLog({
            eval: {
              task: "bundled-task",
              task_id: "bundled-task-id",
            },
          })
        )
      ),
      http.get(
        "*/logs/eval-set.json",
        () => new HttpResponse(null, { status: 404 })
      ),
      http.get(
        "*/logs/flow.yaml",
        () => new HttpResponse(null, { status: 404 })
      )
    );
    await page.route("http://localhost:5174/", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "</head>",
        '<script id="log_dir_context" type="application/json">{"log_dir":"logs"}</script></head>'
      );
      await route.fulfill({ response, body });
    });

    await page.goto("/#/logs/bundled.json");

    await expect(page.locator("#task-title")).toHaveText("bundled-task", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("log-location-gate")).toHaveCount(0);
    expect(logRequests).toContain("http://localhost:5174/logs/listing.json");
    expect(logRequests).toContain("http://localhost:5174/logs/bundled.json");
  });

  test("automatically loads an exact publisher-configured hosted log", async ({
    page,
    network,
  }) => {
    const logUrl = "http://localhost:5174/hosted/fixed.json";
    network.use(
      http.get("*/hosted/fixed.json", () =>
        HttpResponse.json(
          createEvalLog({
            eval: {
              task: "fixed-hosted-task",
              task_id: "fixed-hosted-task-id",
            },
          })
        )
      )
    );
    await page.route("http://localhost:5174/", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "</head>",
        `<script id="log_dir_context" type="application/json">${JSON.stringify({
          log_file: logUrl,
        })}</script></head>`
      );
      await route.fulfill({ response, body });
    });

    await page.goto("/");

    await expect(page.locator("#task-title")).toHaveText("fixed-hosted-task", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("log-location-gate")).toHaveCount(0);
  });

  test("treats an absolute hash route as untrusted selection", async ({
    page,
    network,
  }) => {
    const target = "http://127.0.0.1:9/run.eval";
    const targetRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http://127.0.0.1:9")) {
        targetRequests.push(request.url());
      }
    });
    network.use(
      http.get("*/api/logs", () =>
        HttpResponse.json({ logs: [], log_dir: "/home/test/logs" })
      ),
      http.get("*/api/log-files*", () =>
        HttpResponse.json({ files: [], response_type: "full" })
      )
    );

    await page.goto(`/#/logs/${encodeURIComponent(target)}`);

    await expect(page.getByTestId("log-location-gate")).toBeVisible({
      timeout: 10_000,
    });
    expect(targetRequests).toEqual([]);
  });

  test("ignores window log updates outside VS Code", async ({
    page,
    network,
  }) => {
    const targetRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http://127.0.0.1:9")) {
        targetRequests.push(request.url());
      }
    });
    network.use(
      http.get("*/api/logs", () =>
        HttpResponse.json({ logs: [], log_dir: "/home/test/logs" })
      ),
      http.get("*/api/log-files*", () =>
        HttpResponse.json({ files: [], response_type: "full" })
      )
    );

    await page.goto("/");
    await expect(page.locator(".ag-root")).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "backgroundUpdate",
          url: "http://127.0.0.1:9/run.eval",
          log_dir: "/home/test/logs",
        },
        "*"
      );
    });
    await page.waitForTimeout(100);

    expect(targetRequests).toEqual([]);
    await expect(page.getByTestId("log-location-gate")).toHaveCount(0);
  });

  test("ignores embedded VS Code state in a normal page", async ({
    page,
    network,
  }) => {
    const target = "http://127.0.0.1:9/run.eval";
    const targetRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http://127.0.0.1:9")) {
        targetRequests.push(request.url());
      }
    });
    network.use(
      http.get("*/api/logs", () =>
        HttpResponse.json({ logs: [], log_dir: "/home/test/logs" })
      ),
      http.get("*/api/log-files*", () =>
        HttpResponse.json({ files: [], response_type: "full" })
      )
    );
    await page.route("http://localhost:5174/", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "</head>",
        `<script id="logview-state" type="application/json">${JSON.stringify({
          type: "updateState",
          url: target,
        })}</script></head>`
      );
      await route.fulfill({ response, body });
    });

    await page.goto("/");

    await expect(page.locator(".ag-root")).toBeVisible({ timeout: 10_000 });
    expect(targetRequests).toEqual([]);
    await expect(page.getByTestId("log-location-gate")).toHaveCount(0);
  });
});
