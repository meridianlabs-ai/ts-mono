/**
 * E2E tests for chat components in the scout app.
 *
 * These tests exercise ChatView, ChatMessageRow, ToolCallView, and related
 * chat rendering components through the transcript detail Messages tab.
 * They serve as a baseline before migrating chat/ to @tsmono/inspect-components.
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

/** Navigate to Messages tab — used by most tests. */
async function openMessages(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  messagesEvents: MessagesEventsResponse
) {
  await openTranscript(page, network, defaultInfo(), messagesEvents);
  await page.getByRole("tab", { name: "Messages" }).click();
}

// ---------------------------------------------------------------------------
// Basic message rendering
// ---------------------------------------------------------------------------

test.describe("chat message rendering", () => {
  test("renders user and assistant messages", async ({ page, network }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "What is the capital of France?" },
          {
            role: "assistant",
            content: "The capital of France is Paris.",
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 50,
            content: "The capital of France is Paris.",
          }),
        ],
      })
    );

    await expect(
      page.getByText("What is the capital of France?")
    ).toBeVisible();
    await expect(
      page.getByText("The capital of France is Paris.")
    ).toBeVisible();
  });

  test("renders system message", async ({ page, network }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 1,
            tokens: 20,
            content: "Hi there!",
          }),
        ],
      })
    );

    await expect(page.getByText("You are a helpful assistant.")).toBeVisible();
  });

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

    await expect(page.getByText("First question from user")).toBeVisible();
    await expect(page.getByText("First response from assistant")).toBeVisible();
    await expect(page.getByText("Second question from user")).toBeVisible();
    await expect(
      page.getByText("Second response from assistant")
    ).toBeVisible();
  });

  test("renders message with structured content array", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image:",
                refusal: null,
                internal: null,
                citations: null,
              },
              {
                type: "image",
                image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
                detail: "auto",
              },
            ],
          },
          { role: "assistant", content: "I see an image.", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 30,
            content: "I see an image.",
          }),
        ],
      })
    );

    await expect(page.getByText("Describe this image:")).toBeVisible();
    // Image should render as an img element
    await expect(page.locator("img[src^='data:image']")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Tool call rendering
// ---------------------------------------------------------------------------

test.describe("tool call rendering", () => {
  test("renders tool call with function name and output", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          {
            role: "user",
            content: "List the files in the current directory",
          },
          {
            role: "assistant",
            content: "I'll check the directory contents.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: "bash",
                arguments: { cmd: "ls -la" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: "file1.txt\nfile2.txt\nREADME.md",
            id: "msg-t1",
          },
          {
            role: "assistant",
            content:
              "The directory contains file1.txt, file2.txt, and README.md.",
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 3,
            tokens: 100,
            content: "I'll check the directory contents.",
          }),
        ],
      })
    );

    // The tool call function name should appear
    await expect(page.getByText("bash", { exact: false })).toBeVisible();

    // The tool output should be visible (use first() since the text also
    // appears in the assistant's summary message)
    await expect(page.getByText("file1.txt").first()).toBeVisible();
    await expect(page.getByText("README.md").first()).toBeVisible();
  });

  test("renders multiple tool calls from a single assistant message", async ({
    page,
    network,
  }) => {
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

    // Both tool outputs should be visible
    await expect(page.getByText("Contents of file one")).toBeVisible();
    await expect(page.getByText("Contents of file two")).toBeVisible();
  });

  test("renders tool call with error output", async ({ page, network }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Run a command" },
          {
            role: "assistant",
            content: "I'll try running it.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_err",
                type: "function",
                function: "bash",
                arguments: { cmd: "rm -rf /protected" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_err",
            content: "",
            error: {
              type: "permission",
              message: "Permission denied: cannot delete /protected",
            },
            id: "msg-t-err",
          },
          {
            role: "assistant",
            content: "The command failed due to permissions.",
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 80,
            content: "I'll try running it.",
          }),
        ],
      })
    );

    // The error message should be displayed
    await expect(
      page.getByText("Permission denied", { exact: false })
    ).toBeVisible();
  });

  test("renders tool output containing JSON as structured view", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Get the config" },
          {
            role: "assistant",
            content: "Reading config.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_cfg",
                type: "function",
                function: "bash",
                arguments: { cmd: "cat config.json" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_cfg",
            content: '{"port": 8080, "host": "localhost"}',
            id: "msg-t-cfg",
          },
          { role: "assistant", content: "Here is the config.", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 60,
            content: "Reading config.",
          }),
        ],
      })
    );

    // JSON output should be rendered as a structured view (RecordTree formats numbers with locale)
    await expect(page.getByText("8,080").first()).toBeVisible();
    await expect(page.getByText("localhost").first()).toBeVisible();
  });

  test("renders python tool call with syntax-highlighted input", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Calculate something" },
          {
            role: "assistant",
            content: "I'll compute that.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_py",
                type: "function",
                function: "python",
                arguments: { code: "result = 2 + 2\nprint(result)" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_py",
            content: "4",
            id: "msg-t-py",
          },
          { role: "assistant", content: "The result is 4.", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 40,
            content: "I'll compute that.",
          }),
        ],
      })
    );

    // The python function call should be visible
    await expect(
      page.getByText("python", { exact: false }).first()
    ).toBeVisible();

    // The code should be rendered (in a code block with syntax highlighting)
    await expect(page.getByText("result = 2 + 2").first()).toBeVisible();

    // The tool output should show
    await expect(page.locator("text=4").first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

test.describe("message content types", () => {
  test("renders reasoning content in collapsible section", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Think about this carefully" },
          {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                reasoning: "Let me think step by step about this problem.",
                signature: null,
                redacted: false,
              },
              {
                type: "text",
                text: "After careful consideration, the answer is 42.",
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
            endSec: 3,
            tokens: 80,
            content: "After careful consideration, the answer is 42.",
          }),
        ],
      })
    );

    // The text content should be visible
    await expect(
      page.getByText("After careful consideration, the answer is 42.")
    ).toBeVisible();

    // The reasoning section should be present (may be collapsed)
    await expect(
      page.getByText("Reasoning", { exact: false }).first()
    ).toBeVisible();
  });

  test("renders redacted reasoning with summary", async ({ page, network }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Think about this" },
          {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                reasoning: "",
                signature: "abc123",
                redacted: true,
              },
              {
                type: "text",
                text: "Here is my answer.",
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
            content: "Here is my answer.",
          }),
        ],
      })
    );

    await expect(page.getByText("Here is my answer.")).toBeVisible();
    // Redacted reasoning shows encrypted indicator
    await expect(
      page
        .getByText("Reasoning encrypted by model provider", { exact: false })
        .first()
    ).toBeVisible();
  });

  test("strips internal tags from text content", async ({ page, network }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Tell me something" },
          {
            role: "assistant",
            content:
              "Visible text <internal>hidden internal content</internal> more visible text.",
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 1,
            tokens: 20,
            content:
              "Visible text <internal>hidden internal content</internal> more visible text.",
          }),
        ],
      })
    );

    await expect(page.getByText("Visible text")).toBeVisible();
    await expect(page.getByText("more visible text")).toBeVisible();
    // Internal content should NOT be visible
    await expect(page.getByText("hidden internal content")).not.toBeVisible();
  });

  test("renders ANSI codes in tool output", async ({ page, network }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Run a colored command" },
          {
            role: "assistant",
            content: "Running command.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_ansi",
                type: "function",
                function: "bash",
                arguments: { cmd: "echo colored" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_ansi",
            content: "\u001b[32mSuccess\u001b[0m: operation complete",
            id: "msg-t-ansi",
          },
          { role: "assistant", content: "Done.", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 1,
            tokens: 30,
            content: "Running command.",
          }),
        ],
      })
    );

    // The ANSI-rendered text should show the actual content (codes stripped)
    await expect(
      page.getByText("Success", { exact: false }).first()
    ).toBeVisible();
    await expect(
      page.getByText("operation complete", { exact: false }).first()
    ).toBeVisible();
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
// Label / numbering system
// ---------------------------------------------------------------------------

test.describe("label and numbering system", () => {
  test("renders numeric labels for messages in the Messages tab", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "First user message", id: "msg-u1" },
          {
            role: "assistant",
            content: "First assistant reply",
            id: "msg-a1",
          },
          { role: "user", content: "Second user message", id: "msg-u2" },
          {
            role: "assistant",
            content: "Second assistant reply",
            id: "msg-a2",
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 1,
            tokens: 30,
            content: "First assistant reply",
          }),
          createModelEvent({
            uuid: "evt-2",
            startSec: 2,
            endSec: 3,
            tokens: 30,
            content: "Second assistant reply",
          }),
        ],
      })
    );

    // With showLabels=true (default in TranscriptBody), messages should have
    // numeric labels rendered in the grid column
    await expect(page.getByText("First user message")).toBeVisible();
    await expect(page.getByText("Second assistant reply")).toBeVisible();

    // The label numbers 1, 2, 3, 4 should appear as message indices
    // They render in dedicated label cells in the grid layout
    const labels = page.locator("[class*='label']");
    await expect(labels.first()).toBeVisible();
  });

  test("renders tool call labels alongside message labels", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Run a tool", id: "msg-u1" },
          {
            role: "assistant",
            content: "Running tool.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: "bash",
                arguments: { cmd: "echo hi" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: "hi",
            id: "msg-t1",
          },
          {
            role: "assistant",
            content: "Done.",
            id: "msg-a2",
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 50,
            content: "Running tool.",
          }),
        ],
      })
    );

    // Both the assistant message and tool call should render in the grid
    await expect(page.getByText("Running tool.")).toBeVisible();
    await expect(page.getByText("hi").first()).toBeVisible();
    // Tool call view should show the function name
    await expect(page.getByText("bash").first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Think tag stripping
// ---------------------------------------------------------------------------

test.describe("think tag stripping", () => {
  test("strips <think> tags from assistant text content", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Think about this" },
          {
            role: "assistant",
            content:
              "Before thinking <think>internal reasoning that should be hidden</think> after thinking visible.",
            id: null,
          },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 1,
            tokens: 20,
            content:
              "Before thinking <think>internal reasoning that should be hidden</think> after thinking visible.",
          }),
        ],
      })
    );

    await expect(page.getByText("Before thinking")).toBeVisible();
    await expect(page.getByText("after thinking visible")).toBeVisible();
    // Think content must NOT be visible
    await expect(
      page.getByText("internal reasoning that should be hidden")
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Tool call expand / collapse
// ---------------------------------------------------------------------------

test.describe("tool call expand/collapse", () => {
  test("tool input starts collapsed with more toggle visible", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Do something complex" },
          {
            role: "assistant",
            content: "Running complex tool.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_long",
                type: "function",
                function: "bash",
                arguments: {
                  cmd: "echo line1\necho line2\necho line3\necho line4\necho line5\necho line6\necho line7\necho line8\necho line9\necho line10\necho line11\necho line12\necho line13\necho line14\necho line15\necho line16\necho line17\necho line18\necho line19\necho line20\necho line21",
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_long",
            content:
              "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\nline21",
            id: "msg-t-long",
          },
          { role: "assistant", content: "Done.", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 3,
            tokens: 100,
            content: "Running complex tool.",
          }),
        ],
      })
    );

    // The tool call should render
    await expect(page.getByText("bash").first()).toBeVisible();

    // The expandable panel's "more..." toggle should be visible when content
    // overflows the configured line limit
    const moreButtons = page.getByRole("button", { name: /more/i });
    // At least one more button should exist (tool input or output panels)
    const count = await moreButtons.count();
    expect(count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

test.describe("citations rendering", () => {
  test("renders URL citations with numbered references", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Find me some references" },
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Here is some information with citations.",
                refusal: null,
                internal: null,
                citations: [
                  {
                    type: "url",
                    url: "https://example.com/source1",
                    title: "First Source",
                    cited_text: "relevant quote from source",
                  },
                  {
                    type: "url",
                    url: "https://example.com/source2",
                    title: "Second Source",
                    cited_text: null,
                  },
                ],
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
            content: "Here is some information with citations.",
          }),
        ],
      })
    );

    await expect(
      page.getByText("Here is some information with citations.")
    ).toBeVisible();

    // Citation titles should be rendered as links
    const firstLink = page.getByRole("link", { name: "First Source" });
    await expect(firstLink).toBeVisible();
    await expect(firstLink).toHaveAttribute(
      "href",
      "https://example.com/source1"
    );

    const secondLink = page.getByRole("link", { name: "Second Source" });
    await expect(secondLink).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Web search content
// ---------------------------------------------------------------------------

test.describe("web search content", () => {
  test("renders web search query and results in assistant message", async ({
    page,
    network,
  }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "Search for something" },
          {
            role: "assistant",
            content: [
              {
                type: "data",
                data: {
                  type: "server_tool_use",
                  name: "web_search",
                  input: { query: "TypeScript monorepo best practices" },
                },
              },
              {
                type: "data",
                data: {
                  type: "web_search_tool_result",
                  content: [
                    {
                      title: "Monorepo Guide",
                      url: "https://example.com/monorepo",
                      page_age: "2 days ago",
                    },
                    {
                      title: "TS Project Setup",
                      url: "https://example.com/ts-setup",
                      page_age: "1 week ago",
                    },
                  ],
                },
              },
              {
                type: "text",
                text: "Based on my research, here are the best practices.",
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
            endSec: 3,
            tokens: 100,
            content: "Based on my research, here are the best practices.",
          }),
        ],
      })
    );

    // Web search query should render
    await expect(
      page.getByText("TypeScript monorepo best practices", { exact: false })
    ).toBeVisible();

    // Search result titles should appear as links
    await expect(
      page.getByRole("link", { name: "Monorepo Guide" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "TS Project Setup" })
    ).toBeVisible();

    // The text response should also render
    await expect(
      page.getByText("Based on my research", { exact: false })
    ).toBeVisible();
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
// Answer tool (custom rendering)
// ---------------------------------------------------------------------------

test.describe("answer tool custom rendering", () => {
  test("renders answer tool call as code panel", async ({ page, network }) => {
    await openMessages(
      page,
      network,
      createMessagesEventsResponse({
        messages: [
          { role: "user", content: "What is the answer?" },
          {
            role: "assistant",
            content: "I know the answer.",
            id: "msg-a1",
            tool_calls: [
              {
                id: "call_answer",
                type: "function",
                function: "answer",
                arguments: { value: "The final answer is 42" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_answer",
            content: "The final answer is 42",
            id: "msg-t-ans",
          },
          { role: "assistant", content: "There you go.", id: null },
        ],
        events: [
          createModelEvent({
            uuid: "evt-1",
            startSec: 0,
            endSec: 2,
            tokens: 50,
            content: "I know the answer.",
          }),
        ],
      })
    );

    // The answer tool uses SourceCodePanel instead of normal ToolCallView
    // The function call content should be rendered as code
    await expect(
      page.getByText("The final answer is 42", { exact: false }).first()
    ).toBeVisible();

    // It should NOT render the standard ToolTitle header for "answer"
    // (getCustomToolView bypasses the normal rendering)
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

    // Markdown output should be rendered (headings, bold text)
    await expect(
      page.getByText("Findings", { exact: false }).first()
    ).toBeVisible();
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
