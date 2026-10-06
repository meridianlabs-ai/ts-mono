import { http, HttpResponse } from "msw";

import {
  installWebviewHost,
  withWebviewBootstrap,
} from "@tsmono/react/testing";
import { encodeBase64Url } from "@tsmono/util";

import { expect, test } from "./fixtures/app";
import {
  createMessagesEventsResponse,
  createModelEvent,
  createTranscriptInfo,
} from "./fixtures/test-data";

test("full Scout webview restores navigation and still follows host commands", async ({
  page,
  network,
}) => {
  network.use(
    http.get("*/api/v2/topics", () =>
      HttpResponse.json({
        scans: "s1",
        transcripts: "t1",
        "project-config": "p1",
      })
    )
  );
  await page.addInitScript(installWebviewHost);
  await page.route("http://localhost:5176/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: withWebviewBootstrap(await response.text(), {
        "scanview-state": {
          type: "updateRoute",
          route: "/scans",
          mode: "full",
          extensionProtocolVersion: 2,
        },
      }),
    });
  });
  await page.goto("/");
  await expect(page).toHaveURL(/#\/scans/);
  await expect(page.locator("#scans")).toBeVisible();
  await page.locator("#transcripts").click();
  await expect(page).toHaveURL(/#\/transcripts/);
  await page.goto("/");
  await expect(page).toHaveURL(/#\/transcripts/);
  await expect(page.locator("#transcripts")).toBeVisible();

  await page.evaluate(() => {
    window.postMessage(
      {
        type: "updateRoute",
        route: "/project",
        mode: "full",
        extensionProtocolVersion: 2,
      },
      "*"
    );
  });
  await expect(page).toHaveURL(/#\/project/);
  await expect(
    page.getByText("Project", { exact: true }).first()
  ).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/#\/project/);
  await expect(page.locator("#project")).toBeVisible();

  await page.goto("/#/validation");
  await expect(page).toHaveURL(/#\/validation/);
  await expect(page.locator("#validation")).toBeVisible();
});

test("single-file Scout webview restores the transcript event route and display mode", async ({
  page,
  network,
}) => {
  const dir = encodeBase64Url("/home/test/project/.transcripts");
  const routePath = `/transcripts/${dir}/restore-transcript`;
  network.use(
    http.get("*/api/v2/topics", () => HttpResponse.json({ transcripts: "t1" })),
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json(
        createTranscriptInfo({
          transcript_id: "restore-transcript",
          task_id: "Restored transcript",
        })
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
      HttpResponse.json(
        createMessagesEventsResponse({
          events: [
            createModelEvent({
              uuid: "restore-event",
              startSec: 0,
              endSec: 2,
              content: "Restored event content",
            }),
          ],
        })
      )
    )
  );
  await page.addInitScript(installWebviewHost);
  await page.route("http://localhost:5176/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: withWebviewBootstrap(await response.text(), {
        "scanview-state": {
          type: "updateRoute",
          route: routePath,
          mode: "single-file",
          extensionProtocolVersion: 2,
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Events", exact: true }).click();
  await expect(
    page.getByText("Restored event content", { exact: true })
  ).toBeVisible();
  await expect(page.locator("#project")).toHaveCount(0);
  await page.goto("/");
  await expect(page).toHaveURL(/restore-transcript\?tab=transcript-events/);
  await expect(
    page.getByRole("tab", { name: "Events", exact: true })
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("Restored event content", { exact: true })
  ).toBeVisible();
  await expect(page.locator("#project")).toHaveCount(0);

  await page.evaluate((path) => {
    window.postMessage(
      {
        type: "updateRoute",
        route: path,
        mode: "single-file",
        extensionProtocolVersion: 2,
      },
      "*"
    );
  }, `${routePath}/event?event=restore-event`);
  await expect(page).toHaveURL(/\/event\?event=restore-event/);
  await expect(
    page.getByText("Restored event content", { exact: true })
  ).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/event\?event=restore-event/);
  await expect(
    page.getByText("Restored event content", { exact: true })
  ).toBeVisible();
});
