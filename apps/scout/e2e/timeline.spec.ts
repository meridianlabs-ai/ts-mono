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
  createMessagesEventsResponse,
  createModelEvent,
  createTimeline,
  createTimelineScenario,
  createTimelineSpan,
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

// ---------------------------------------------------------------------------
// Characterization: punch-down view stack
// ---------------------------------------------------------------------------

// NOTE: punch-down only supports branches reachable through the root span's
// branch tree whose fork anchor is a direct content event of the parent
// (`spliceToTimeline`/`ancestorChain` walk `branches`, not `content`) — a
// branch attached to a nested agent span crashes on punch-down. This
// scenario therefore attaches the branch (and its anchor) to the root span.
function createRootBranchScenario(): MessagesEventsResponse {
  const rootEvt = createModelEvent({
    uuid: "evt-root-1",
    startSec: 0,
    endSec: 2,
    tokens: 100,
    content: "Planning the work",
    spanId: "transcript",
  });
  const evt1 = createModelEvent({
    uuid: "evt-explore-1",
    startSec: 2,
    endSec: 5,
    tokens: 200,
    content: "Exploring the codebase",
    spanId: "explore",
  });
  const evt2 = createModelEvent({
    uuid: "evt-build-1",
    startSec: 8,
    endSec: 14,
    tokens: 400,
    content: "Building the feature",
    spanId: "build",
  });
  // splice() cuts the parent's stream at the AnchorEvent matching the
  // branch's branched_from — the fork point must be an anchor event in the
  // parent's direct content.
  const anchorEvt = {
    event: "anchor",
    anchor_id: "fork-1",
    uuid: "evt-anchor-1",
    timestamp: "2025-01-15T10:00:06Z",
    working_start: 6,
    span_id: "transcript",
    metadata: null,
    pending: null,
    source: null,
  } as unknown as MessagesEventsResponse["events"][number];
  const branchEvt = createModelEvent({
    uuid: "evt-branch-1",
    startSec: 10,
    endSec: 12,
    tokens: 150,
    content: "Branch attempt",
    spanId: "branch-1",
  });
  // The branch carries an agent span in its event stream so the spliced
  // standalone timeline has swimlane structure (otherwise the header — and
  // with it the back button — would not render).
  type ScoutEvent = MessagesEventsResponse["events"][number];
  const branchSpanBegin = {
    event: "span_begin",
    id: "retry",
    name: "Retry",
    type: "agent",
    parent_id: null,
    span_id: "branch-1",
    uuid: "evt-sb-retry",
    timestamp: "2025-01-15T10:00:11Z",
    working_start: 11,
    metadata: null,
    pending: null,
  } as unknown as ScoutEvent;
  const branchInnerEvt = {
    ...createModelEvent({
      uuid: "evt-retry-1",
      startSec: 11,
      endSec: 12,
      tokens: 100,
      content: "Retrying the approach",
      spanId: "retry",
    }),
  } as unknown as ScoutEvent;
  const branchSpanEnd = {
    event: "span_end",
    id: "retry",
    span_id: "branch-1",
    uuid: "evt-se-retry",
    timestamp: "2025-01-15T10:00:12Z",
    working_start: 12,
    metadata: null,
    pending: null,
  } as unknown as ScoutEvent;

  const rootSpan = createTimelineSpan({
    id: "transcript",
    name: "Transcript",
    span_type: "agent",
    content: [
      { type: "event", event: "evt-root-1" },
      { type: "event", event: "evt-anchor-1" },
      createTimelineSpan({
        id: "explore",
        name: "Explore",
        span_type: "agent",
        content: [{ type: "event", event: "evt-explore-1" }],
      }),
      createTimelineSpan({
        id: "build",
        name: "Build",
        span_type: "agent",
        content: [{ type: "event", event: "evt-build-1" }],
      }),
    ],
    branches: [
      createTimelineSpan({
        id: "branch-1",
        name: "branch",
        span_type: "branch",
        branched_from: "fork-1",
        content: [
          { type: "event", event: "evt-branch-1" },
          { type: "event", event: "evt-sb-retry" },
          { type: "event", event: "evt-retry-1" },
          { type: "event", event: "evt-se-retry" },
        ],
      }),
    ],
  });

  return createMessagesEventsResponse({
    messages: [{ role: "user", content: "Help me refactor this code" }],
    events: [
      rootEvt,
      anchorEvt,
      evt1,
      evt2,
      branchEvt,
      branchSpanBegin,
      branchInnerEvt,
      branchSpanEnd,
    ],
    timelines: [createTimeline(rootSpan)],
  });
}

test("punch-down opens a branch as a standalone timeline and back returns", async ({
  page,
  network,
}) => {
  setupTranscriptWithTimeline(network, createRootBranchScenario());
  await page.goto(transcriptUrl());

  const swimlane = page.getByRole("grid", { name: "Timeline swimlane" });
  await expect(swimlane).toBeVisible();

  // Reveal the branch row via the root row's branch marker.
  const branchMarker = swimlane
    .getByRole("button", { name: "Toggle branches" })
    .first();
  await branchMarker.click();
  const branchRow = swimlane.getByRole("row").filter({ hasText: "Branch 1" });
  await expect(branchRow).toBeVisible();

  // Punch down into the branch (button appears on row hover).
  await branchRow.hover();
  await branchRow
    .locator('button[title="Open as standalone timeline"]')
    .click();

  // Standalone view: the back button shows and the sibling agent rows are
  // replaced by the branch's own view.
  const backButton = page.locator('button[title="Back to branch overview"]');
  await expect(backButton).toBeVisible();
  await expect(
    swimlane.getByRole("row").filter({ hasText: "Explore" })
  ).toBeHidden();

  // Pop back to the full timeline.
  await backButton.click();
  await expect(backButton).toBeHidden();
  await expect(
    swimlane.getByRole("row").filter({ hasText: "Explore" })
  ).toBeVisible();
});
