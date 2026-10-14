import { http, HttpResponse } from "msw";

import { encodeBase64Url } from "@tsmono/util";

import type {
  AppConfig,
  MessagesEventsResponse,
  TranscriptInfo,
  TranscriptsResponse,
} from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import {
  createAppConfig,
  createMessagesEventsResponse,
  createModelEvent,
  createTranscriptInfo,
  createTranscriptsResponse,
} from "./fixtures/test-data";

const TRANSCRIPTS_DIR = "/home/test/project/.transcripts";
const TRANSCRIPT_ID = "t-001";

test("clicking a transcript row opens the transcript detail panel", async ({
  page,
  network,
}) => {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(
        createTranscriptsResponse([
          createTranscriptInfo({
            transcript_id: TRANSCRIPT_ID,
            task_id: "my-task",
            model: "claude-3",
            date: "2024-01-15T10:30:00Z",
          }),
        ])
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json<TranscriptInfo>(
        createTranscriptInfo({
          transcript_id: TRANSCRIPT_ID,
          task_id: "my-task",
          model: "claude-3",
          date: "2024-01-15T10:30:00Z",
        })
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
      HttpResponse.json<MessagesEventsResponse>(createMessagesEventsResponse())
    )
  );

  await page.goto("/#/transcripts");
  await page.getByText("my-task").first().click();

  await expect(page).toHaveURL(
    `/#/transcripts/${encodeBase64Url(TRANSCRIPTS_DIR)}/${TRANSCRIPT_ID}`
  );
  await expect(page.getByText(`Transcript — ${TRANSCRIPT_ID}`)).toBeVisible();
});

test("transcript metadata tab shows the transcript's metadata", async ({
  page,
  network,
}) => {
  const info = createTranscriptInfo({
    transcript_id: TRANSCRIPT_ID,
    task_id: "metadata-task",
    metadata: { experiment: "cache-perf", run_number: 42 },
  });
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(createTranscriptsResponse([info]))
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json<TranscriptInfo>(info)
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
      HttpResponse.json<MessagesEventsResponse>(
        createMessagesEventsResponse({
          messages: [{ role: "user", content: "Hello" }],
          events: [],
        })
      )
    )
  );

  await page.goto(
    `/#/transcripts/${encodeBase64Url(TRANSCRIPTS_DIR)}/${TRANSCRIPT_ID}`
  );
  await page.getByRole("tab", { name: "Metadata" }).click();

  await expect(page.getByText("experiment")).toBeVisible();
  await expect(page.getByText("cache-perf")).toBeVisible();
});

const ALTERNATE_DIR = "/home/test/secondary";

/** Serves the same transcript id from two directories, each with its own
 *  evidence text, and optionally configures the primary one. */
function serveTwoDirectories(
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  configured: boolean
) {
  const encodedAlternate = encodeBase64Url(ALTERNATE_DIR);
  network.use(
    http.get("*/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(
        createAppConfig({
          transcripts: configured
            ? { dir: TRANSCRIPTS_DIR, source: "project" }
            : null,
        })
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", ({ params }) =>
      HttpResponse.json<TranscriptInfo>(
        createTranscriptInfo({
          transcript_id: TRANSCRIPT_ID,
          task_id:
            params.dir === encodedAlternate ? "Secondary task" : "Primary task",
        })
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", ({ params }) => {
      const content =
        params.dir === encodedAlternate
          ? "Evidence from secondary"
          : "Evidence from primary";
      return HttpResponse.json<MessagesEventsResponse>(
        createMessagesEventsResponse({
          messages: [{ id: "shared-message", role: "assistant", content }],
          events: [
            createModelEvent({
              uuid: "shared-event",
              startSec: 0,
              endSec: 1,
              content,
            }),
          ],
        })
      );
    })
  );
}

for (const { view, suffix } of [
  { view: "transcript", suffix: "?tab=transcript-messages" },
  { view: "focused event", suffix: "/event?event=shared-event&tab=Summary" },
]) {
  const route = (directory: string) =>
    `/transcripts/${encodeBase64Url(directory)}/${TRANSCRIPT_ID}${suffix}`;

  test(`${view} loads the route directory with no configured directory`, async ({
    page,
    network,
  }) => {
    serveTwoDirectories(network, false);
    await page.goto(`/#${route(ALTERNATE_DIR)}`);

    await expect(
      page.getByText("Evidence from secondary", { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText("Evidence from primary", { exact: true })
    ).toHaveCount(0);
  });

  test(`${view} loads the route directory with a different configured directory`, async ({
    page,
    network,
  }) => {
    serveTwoDirectories(network, true);
    const primary = page.getByText("Evidence from primary", { exact: true });
    const secondary = page.getByText("Evidence from secondary", {
      exact: true,
    });

    await page.goto(`/#${route(TRANSCRIPTS_DIR)}`);
    await expect(primary.first()).toBeVisible();

    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, route(ALTERNATE_DIR));
    await expect(secondary.first()).toBeVisible();
    await expect(primary).toHaveCount(0);

    await page.goBack();
    await expect(primary.first()).toBeVisible();
    await expect(secondary).toHaveCount(0);
  });
}

test("transcript panel shows error state when API fails", async ({
  page,
  network,
  disableRetries: _,
}) => {
  network.use(
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.text("Internal Server Error", { status: 500 })
    )
  );

  const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
  await page.goto(`/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}`);

  await expect(page.getByText("Error Loading Transcript")).toBeVisible();
});
