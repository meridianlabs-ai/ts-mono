/**
 * E2E tests for chat components in the scout app.
 *
 * These tests exercise ChatView, ChatMessageRow, ToolCallView, and related
 * chat rendering components through the transcript detail Messages tab.
 * Rendering of the shared chat components is covered in inspect's
 * chat-components.spec.ts; these tests cover scout's own message data path
 * and scout-specific tool views.
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
const TRANSCRIPT_ID = "t-chat-001";

/** Navigate to a transcript detail page with the given mock data. */
async function openTranscript(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  info: TranscriptInfo,
  messagesEvents: MessagesEventsResponse
) {
  network.use(
    http.post("*/api/v2/transcripts/:dir", () =>
      HttpResponse.json<TranscriptsResponse>(createTranscriptsResponse([info]))
    ),
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json<TranscriptInfo>(info)
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
      HttpResponse.json<MessagesEventsResponse>(messagesEvents)
    )
  );

  const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
  await page.goto(`/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}`);
}

function defaultInfo(overrides?: Partial<TranscriptInfo>): TranscriptInfo {
  return createTranscriptInfo({
    transcript_id: TRANSCRIPT_ID,
    task_id: "chat-test",
    model: "claude-sonnet-4-5-20250929",
    date: "2025-01-15T10:00:00Z",
    ...overrides,
  });
}

/** Asserts each text is visible and rendered below the previous one. */
async function expectTopToBottom(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  texts: string[]
) {
  const tops: number[] = [];
  for (const text of texts) {
    const locator = page.getByText(text, { exact: true });
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, text).not.toBeNull();
    tops.push(box?.y ?? Number.NaN);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
}

/** Navigate to Messages tab — used by most tests. */
async function openMessages(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  messagesEvents: MessagesEventsResponse
) {
  await openTranscript(page, network, defaultInfo(), messagesEvents);
  // Target the transcript's top-level Messages tab by id — model-call panels
  // also have a "Messages" tab, so the accessible name alone is ambiguous.
  await page.locator("#transcript-messages").click();
}

// ---------------------------------------------------------------------------
// Basic message rendering
// ---------------------------------------------------------------------------

test.describe("chat message rendering", () => {
  test("renders multi-turn conversation in order", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "First question from user" },
          {
            role: "assistant",
            content: "First response from assistant",
            id: null,
          },
          { role: "user", content: "Second question from user" },
          {
            role: "assistant",
            content: "Second response from assistant",
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 50,
            content: "First response from assistant",
          }),
          createModelEvent({
            uuid: "evt-2",
            startSec: 3,
            endSec: 5,
            tokens: 50,
            content: "Second response from assistant",
          }),
        ],
      })
    );

    await expectTopToBottom(page, [
      "First question from user",
      "First response from assistant",
      "Second question from user",
      "Second response from assistant",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tool call rendering
// ---------------------------------------------------------------------------

test.describe("tool call rendering", () => {
  test("pairs each tool call with its output", async ({ page, network }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Check both files" },
          {
            role: "assistant",
            content: "I'll read both files.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_read1",
                type: "function",
                function: "bash",
                arguments: { cmd: "cat file1.txt" },
              },
              {
                id: "call_read2",
                type: "function",
                function: "bash",
                arguments: { cmd: "cat file2.txt" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_read1",
            content: "Contents of file one",
            id: "msg-t1",
          },
          {
            role: "tool",
            tool_call_id: "call_read2",
            content: "Contents of file two",
            id: "msg-t2",
          },
          {
            role: "assistant",
            content: "Both files have been read.",
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 3,
            tokens: 100,
            content: "I'll read both files.",
          }),
        ],
      })
    );

    await expectTopToBottom(page, [
      "cat file1.txt",
      "Contents of file one",
      "cat file2.txt",
      "Contents of file two",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Events tab
// ---------------------------------------------------------------------------

test.describe("events tab", () => {
  test("renders model event with token count", async ({ page, network }) => {
    await openTranscript(
      page,
      network,
      defaultInfo(),
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Search for something" },
          { role: "assistant", content: "I found results.", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-search",
            startSec: 0,
            endSec: 3,
            tokens: 150,
            content: "I found results.",
          }),
        ],
      })
    );

    // Events tab is shown by default — model event should render
    const modelCallHeading = page.getByText("Model Call:", { exact: false });
    await expect(modelCallHeading).toBeVisible();
    await expect(modelCallHeading).toContainText("150");
  });
});

// ---------------------------------------------------------------------------
// Server tool calls (MCP)
// ---------------------------------------------------------------------------

test.describe("server tool calls", () => {
  test("renders server tool use content with arguments", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Use the file tool" },
          {
            role: "assistant",
            content: [
              {
                type: "data",
                data: {
                  type: "server_tool_use",
                  name: "read_file",
                  context: "filesystem",
                  input: { path: "/src/main.ts" },
                  result: "const app = express();",
                },
              },
              {
                type: "text",
                text: "I read the file contents.",
                refusal: null,
                internal: null,
                citations: null,
              },
            ],
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 60,
            content: "I read the file contents.",
          }),
        ],
      })
    );

    // Server tool name should be visible
    await expect(
      page.getByText("read_file", { exact: false }).first()
    ).toBeVisible();

    // The result should render
    await expect(
      page.getByText("const app = express()", { exact: false }).first()
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Task tool (subagent display + markdown output)
// ---------------------------------------------------------------------------

test.describe("Task tool rendering", () => {
  test("renders Task tool with subagent type and markdown output", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Research this topic" },
          {
            role: "assistant",
            content: "I'll delegate to a research agent.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_task",
                type: "function",
                function: "Task",
                arguments: {
                  subagent_type: "researcher",
                  prompt: "Find information about TypeScript monorepos.",
                  description: "Research task for monorepo patterns",
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_task",
            content:
              "## Findings\n\nTypeScript monorepos typically use:\n\n- **Turborepo** for task orchestration\n- **pnpm workspaces** for package management",
            id: "msg-t-task",
            function: "Task",
          },
          { role: "assistant", content: "Research complete.", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 5,
            tokens: 200,
            content: "I'll delegate to a research agent.",
          }),
        ],
      })
    );

    // Task tool should show "Task: researcher" as the title
    await expect(
      page.getByText("Task: researcher", { exact: false }).first()
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
    await expect(
      page.getByText("Turborepo", { exact: false }).first()
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Compaction data
// ---------------------------------------------------------------------------

test.describe("compaction data", () => {
  test("renders compaction content with compacted header", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Start conversation" },
          {
            role: "assistant",
            content: [
              {
                type: "data",
                data: {
                  compaction_metadata: {
                    type: "anthropic_compact",
                    content:
                      "This is a summary of the previous conversation context that was compacted.",
                  },
                },
              },
              {
                type: "text",
                text: "Continuing from where we left off.",
                refusal: null,
                internal: null,
                citations: null,
              },
            ],
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 40,
            content: "Continuing from where we left off.",
          }),
        ],
      })
    );

    // The "Compacted Content" header should be visible
    await expect(
      page.getByText("Compacted Content", { exact: false })
    ).toBeVisible();

    // The continuation text should also render
    await expect(
      page.getByText("Continuing from where we left off.")
    ).toBeVisible();
  });
});
