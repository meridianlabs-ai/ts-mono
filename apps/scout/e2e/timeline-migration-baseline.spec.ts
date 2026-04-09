/**
 * Migration baseline e2e tests for the transcript panel composition.
 *
 * These tests verify that the three key pieces — swimlanes, outline, and
 * event list — render together correctly. They serve as a safety net
 * during the migration to a shared TimelineTranscriptView component.
 */

import { http, HttpResponse } from "msw";

import { encodeBase64Url } from "@tsmono/util";

import type {
  MessagesEventsResponse,
  TranscriptInfo,
  TranscriptsResponse,
} from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import {
  createTimelineScenario,
  createTranscriptInfo,
  createTranscriptsResponse,
} from "./fixtures/test-data";

const TRANSCRIPTS_DIR = "/home/test/project/.transcripts";
const TRANSCRIPT_ID = "t-baseline-001";

function setupTranscript(
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  messagesEvents: MessagesEventsResponse
) {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(
        createTranscriptsResponse([
          createTranscriptInfo({
            transcript_id: TRANSCRIPT_ID,
            task_id: "baseline-task",
            model: "claude-3",
          }),
        ])
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json<TranscriptInfo>(
        createTranscriptInfo({
          transcript_id: TRANSCRIPT_ID,
          task_id: "baseline-task",
          model: "claude-3",
        })
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
      HttpResponse.json<MessagesEventsResponse>(messagesEvents)
    )
  );
}

function transcriptUrl(): string {
  const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
  return `/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}`;
}

// ---------------------------------------------------------------------------
// Composition: all three pieces render together
// ---------------------------------------------------------------------------

test("transcript panel renders swimlanes, outline, and event list together", async ({
  page,
  network,
}) => {
  setupTranscript(network, createTimelineScenario());
  await page.goto(transcriptUrl());

  // Swimlane grid is visible with child rows
  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();
  await expect(
    swimlane.getByRole("row").filter({ hasText: "Explore" })
  ).toBeVisible();

  // Outline sidebar is visible (rendered as a Virtuoso list with id="transcript-tree")
  const outline = page.locator("#transcript-tree");
  await expect(outline).toBeVisible();

  // Event list shows agent cards from the timeline
  await expect(page.getByText("SUB-AGENT: EXPLORE")).toBeVisible();
  await expect(page.getByText("SUB-AGENT: BUILD")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Swimlane selection filters event list
// ---------------------------------------------------------------------------

test("clicking a swimlane row updates the URL selection", async ({
  page,
  network,
}) => {
  setupTranscript(network, createTimelineScenario());
  await page.goto(transcriptUrl());

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Click the "Explore" row to select it
  const exploreRow = swimlane.getByRole("row").filter({ hasText: "Explore" });
  await exploreRow.click();

  // Selection is URL-driven — the "selected" search param should now be set
  await expect(page).toHaveURL(/selected=/);
});

// ---------------------------------------------------------------------------
// No timeline: flat event list with outline, no swimlanes
// ---------------------------------------------------------------------------

test("transcript without timelines renders flat event list and outline", async ({
  page,
  network,
}) => {
  setupTranscript(network, {
    messages: [{ role: "user", content: "Hello" }],
    events: [],
    timelines: [],
  });
  await page.goto(transcriptUrl());

  // Page loads without errors
  await expect(page.getByText("baseline-task").first()).toBeVisible();

  // Swimlane grid should either not exist or be minimally rendered
  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  const rowCount = await swimlane.getByRole("row").count();
  expect(rowCount).toBeLessThanOrEqual(1);
});
