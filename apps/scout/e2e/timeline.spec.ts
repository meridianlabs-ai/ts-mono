import type { NetworkFixture } from "@msw/playwright";
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
const TRANSCRIPT_ID = "t-timeline-001";

/** Navigate directly to a transcript detail page with the given response data. */
function setupTranscriptWithTimeline(
  network: NetworkFixture,
  messagesEvents: MessagesEventsResponse
) {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(
        createTranscriptsResponse([
          createTranscriptInfo({
            transcript_id: TRANSCRIPT_ID,
            task_id: "timeline-task",
            model: "claude-3",
          }),
        ])
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json<TranscriptInfo>(
        createTranscriptInfo({
          transcript_id: TRANSCRIPT_ID,
          task_id: "timeline-task",
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
// P0: Timeline swimlane renders with timeline data
// ---------------------------------------------------------------------------

test("timeline swimlane renders rows from server timeline data", async ({
  page,
  network,
}) => {
  setupTranscriptWithTimeline(network, createTimelineScenario());
  await page.goto(transcriptUrl());

  // The swimlane grid should appear
  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Row labels for the child spans should be visible
  // (root "Transcript" is depth 0, children "Explore" and "Build" are depth 1)
  await expect(
    swimlane.getByRole("row").filter({ hasText: "Explore" })
  ).toBeVisible();
  await expect(
    swimlane.getByRole("row").filter({ hasText: "Build" })
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// P0: Swimlane row collapse/expand
// ---------------------------------------------------------------------------

test("clicking chevron collapses and expands child rows", async ({
  page,
  network,
}) => {
  setupTranscriptWithTimeline(network, createTimelineScenario());
  await page.goto(transcriptUrl());

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Child rows should be visible initially (root is expanded by default)
  const exploreRow = swimlane.getByRole("row").filter({ hasText: "Explore" });
  await expect(exploreRow).toBeVisible();

  // Click the collapse button on the root row (the "Transcript" row has children)
  const collapseButton = swimlane
    .getByRole("button", { name: "Collapse" })
    .first();
  await collapseButton.click();

  // Child rows should now be hidden
  await expect(exploreRow).toBeHidden();

  // Click expand to bring them back
  const expandButton = swimlane.getByRole("button", { name: "Expand" }).first();
  await expandButton.click();

  await expect(exploreRow).toBeVisible();
});

// ---------------------------------------------------------------------------
// P0: Branch marker click expands row and enables branches
// ---------------------------------------------------------------------------

test("row with branches shows chevron even before branches are expanded", async ({
  page,
  network,
}) => {
  setupTranscriptWithTimeline(
    network,
    createTimelineScenario({ withBranch: true })
  );
  await page.goto(transcriptUrl());

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Build row should show an "Expand" chevron even though showBranches is off,
  // because it has branch markers indicating expandable children.
  const buildRow = swimlane.getByRole("row").filter({ hasText: "Build" });
  await expect(buildRow.getByRole("button", { name: "Expand" })).toBeVisible();
});

test("clicking chevron on row with branches enables showBranches and reveals branch rows", async ({
  page,
  network,
}) => {
  setupTranscriptWithTimeline(
    network,
    createTimelineScenario({ withBranch: true })
  );
  await page.goto(transcriptUrl());

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Click the Expand chevron on the Build row
  const buildRow = swimlane.getByRole("row").filter({ hasText: "Build" });
  await buildRow.getByRole("button", { name: "Expand" }).click();

  // Branch row should now be visible (showBranches auto-enabled)
  const branchRow = swimlane.getByRole("row").filter({ hasText: "Branch 1" });
  await expect(branchRow).toBeVisible();
});

test("clicking branch marker auto-expands parent row", async ({
  page,
  network,
}) => {
  setupTranscriptWithTimeline(
    network,
    createTimelineScenario({ withBranch: true })
  );
  await page.goto(transcriptUrl());

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Click the branch marker (diamond icon)
  const branchMarker = swimlane
    .getByRole("button", { name: "Toggle branches" })
    .first();
  await branchMarker.click();

  // Branch row should be visible immediately (parent auto-expanded)
  const branchRow = swimlane.getByRole("row").filter({ hasText: "Branch 1" });
  await expect(branchRow).toBeVisible();

  // Build row should show "Collapse" chevron (expanded state)
  const buildRow = swimlane.getByRole("row").filter({ hasText: "Build" });
  await expect(
    buildRow.getByRole("button", { name: "Collapse" })
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// P1: Transcript with no timeline data falls back gracefully
// ---------------------------------------------------------------------------

test("transcript without timeline data renders without swimlane rows", async ({
  page,
  network,
}) => {
  setupTranscriptWithTimeline(
    network,
    // No timelines, no events — the swimlane should still render but be collapsed/empty
    {
      messages: [{ role: "user", content: "Hello" }],
      events: [],
      timelines: [],
    }
  );
  await page.goto(transcriptUrl());

  // The page should load without errors — check for the transcript task info
  await expect(page.getByText("timeline-task").first()).toBeVisible();

  // No swimlane rows should be present (or the swimlane is auto-collapsed)
  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  // With no timeline data, swimlane may still render but with no meaningful rows
  // The key assertion: the page doesn't crash and the transcript content is accessible
  const rowCount = await swimlane.getByRole("row").count();
  // At most the root row (or 0 if completely hidden)
  expect(rowCount).toBeLessThanOrEqual(1);
});
