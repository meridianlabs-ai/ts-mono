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

  await expect(page.getByText("my-task").first()).toBeVisible();
  await expect(page.getByText("claude-3")).toBeVisible();
});

for (const focused of [false, true]) {
  for (const configured of [false, true]) {
    test(`${focused ? "focused event" : "transcript"} loads the route directory with ${configured ? "a different" : "no"} configured directory`, async ({
      page,
      network,
    }) => {
      const alternate = "/home/test/secondary";
      const encodedAlternate = encodeBase64Url(alternate);
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
                params.dir === encodedAlternate
                  ? "Secondary task"
                  : "Primary task",
            })
          )
        ),
        http.get(
          "*/api/v2/transcripts/:dir/:id/messages-events",
          ({ params }) => {
            const content =
              params.dir === encodedAlternate
                ? "Evidence from secondary"
                : "Evidence from primary";
            return HttpResponse.json<MessagesEventsResponse>(
              createMessagesEventsResponse({
                messages: [
                  { id: "shared-message", role: "assistant", content },
                ],
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
          }
        )
      );
      const suffix = focused
        ? "/event?event=shared-event&tab=Summary"
        : "?tab=transcript-messages";
      const route = (directory: string) =>
        `/transcripts/${directory}/${TRANSCRIPT_ID}${suffix}`;
      if (configured) {
        await page.goto(`/#${route(encodeBase64Url(TRANSCRIPTS_DIR))}`);
        await expect(
          page.getByText("Evidence from primary", { exact: true }).first()
        ).toBeVisible();
        await page.evaluate((hash) => {
          window.location.hash = hash;
        }, route(encodedAlternate));
      } else {
        await page.goto(`/#${route(encodedAlternate)}`);
      }
      await expect(
        page.getByText("Evidence from secondary", { exact: true }).first()
      ).toBeVisible();
      await expect(
        page.getByText("Evidence from primary", { exact: true })
      ).toHaveCount(0);
      if (configured) {
        await page.goBack();
        await expect(
          page.getByText("Evidence from primary", { exact: true }).first()
        ).toBeVisible();
        await expect(
          page.getByText("Evidence from secondary", { exact: true })
        ).toHaveCount(0);
      }
    });
  }
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
