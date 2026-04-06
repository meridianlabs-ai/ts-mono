/**
 * E2E tests verifying that components migrated to @tsmono/inspect-components
 * render correctly in the scout app. These tests exercise the content/ and
 * usage/ components (MetaDataGrid, RenderedText, ModelUsagePanel, etc.)
 * through real UI flows.
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
  createMessagesEventsResponse,
  createModelEvent,
  createTranscriptInfo,
  createTranscriptsResponse,
} from "./fixtures/test-data";

const TRANSCRIPTS_DIR = "/home/test/project/.transcripts";
const TRANSCRIPT_ID = "t-shared-001";

/**
 * Helper to build a transcript with a user message and a model response
 * that has usage data, exercising RenderedText (message content) and
 * ModelUsagePanel (token display) from @tsmono/inspect-components.
 */
function transcriptWithModelEvent(): MessagesEventsResponse {
  return createMessagesEventsResponse({
    messages: [
      { role: "user", content: "Explain how caching works" },
      {
        role: "assistant",
        content: "Caching stores frequently accessed data in a fast layer.",
        id: null,
      },
    ],
    events: [
      createModelEvent({
        uuid: "evt-model-1",
        startSec: 0,
        endSec: 5,
        tokens: 500,
        content: "Caching stores frequently accessed data in a fast layer.",
      }),
    ],
  });
}

test.describe("shared components from @tsmono/inspect-components", () => {
  test("transcript detail renders message content via shared RenderedText", async ({
    page,
    network,
  }) => {
    const info = createTranscriptInfo({
      transcript_id: TRANSCRIPT_ID,
      task_id: "cache-task",
      model: "claude-sonnet-4-5-20250929",
      date: "2025-01-15T10:00:00Z",
    });

    network.use(
      http.post("*/api/v2/transcripts/:dir", () =>
        HttpResponse.json<TranscriptsResponse>(
          createTranscriptsResponse([info])
        )
      ),
      http.get("*/api/v2/transcripts/:dir/:id/info", () =>
        HttpResponse.json<TranscriptInfo>(info)
      ),
      http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
        HttpResponse.json<MessagesEventsResponse>(transcriptWithModelEvent())
      )
    );

    const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
    await page.goto(`/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}`);

    // The Events tab shows the model event with assistant output,
    // rendered through the shared RenderedText component
    await expect(
      page
        .getByText("Caching stores frequently accessed data", { exact: false })
        .first()
    ).toBeVisible();

    // Switch to Messages tab — user message rendered via shared RenderedText
    await page.getByRole("tab", { name: "Messages" }).click();
    await expect(page.getByText("Explain how caching works")).toBeVisible();
  });

  test("transcript model event renders token usage via shared ModelUsagePanel", async ({
    page,
    network,
  }) => {
    const info = createTranscriptInfo({
      transcript_id: TRANSCRIPT_ID,
      task_id: "usage-task",
      model: "claude-sonnet-4-5-20250929",
      date: "2025-01-15T10:00:00Z",
    });

    network.use(
      http.post("*/api/v2/transcripts/:dir", () =>
        HttpResponse.json<TranscriptsResponse>(
          createTranscriptsResponse([info])
        )
      ),
      http.get("*/api/v2/transcripts/:dir/:id/info", () =>
        HttpResponse.json<TranscriptInfo>(info)
      ),
      http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
        HttpResponse.json<MessagesEventsResponse>(transcriptWithModelEvent())
      )
    );

    const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
    await page.goto(`/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}`);

    // Wait for the model event to render, then expand the "All" tab
    // which contains Usage and Configuration sections
    const modelCallHeading = page.getByText("Model Call:", { exact: false });
    await expect(modelCallHeading).toBeVisible();

    // The model event title should include the token count (500 total)
    // formatTitle includes total_tokens in the heading
    await expect(modelCallHeading).toContainText("500");
  });

  test("transcript metadata tab renders shared MetaDataGrid", async ({
    page,
    network,
  }) => {
    const info = createTranscriptInfo({
      transcript_id: TRANSCRIPT_ID,
      task_id: "metadata-task",
      model: "claude-sonnet-4-5-20250929",
      date: "2025-01-15T10:00:00Z",
      metadata: {
        experiment: "cache-perf",
        run_number: 42,
      },
    });

    network.use(
      http.post("*/api/v2/transcripts/:dir", () =>
        HttpResponse.json<TranscriptsResponse>(
          createTranscriptsResponse([info])
        )
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

    const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
    await page.goto(`/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}`);

    // Navigate to the Metadata tab — MetaDataGrid renders key/value pairs
    const metadataTab = page.getByRole("tab", { name: "Metadata" });
    await metadataTab.click();

    // Metadata values rendered through the shared MetaDataGrid component
    await expect(page.getByText("experiment")).toBeVisible();
    await expect(page.getByText("cache-perf")).toBeVisible();
  });
});
