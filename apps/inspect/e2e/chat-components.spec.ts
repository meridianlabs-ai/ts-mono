/**
 * E2E tests for chat components in the inspect app.
 *
 * These tests exercise ChatView, ChatViewVirtualList, ToolCallView, and related
 * chat rendering components through the sample detail Messages tab.
 */
import type { Locator } from "@playwright/test";
import { http, HttpResponse } from "msw";

import type { ChatMessage } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
} from "./fixtures/test-data";

const LOG_FILE = "test-chat.json";
const MEDIA_ORIGIN = "https://media.invalid";

/**
 * Set up mock handlers for a single log file containing one sample,
 * then navigate to that sample's detail view.
 */
async function openSample(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  messages: ChatMessage[],
  options?: { sampleId?: number | string; epoch?: number }
) {
  const sampleId = options?.sampleId ?? 1;
  const epoch = options?.epoch ?? 1;

  const sample = createEvalSample({ id: sampleId, epoch, messages });
  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    // get_log_root — the dir-mode gate blocks on this.
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),

    // Log file listing — return our single log
    http.get("*/api/log-files*", () => {
      return HttpResponse.json({
        files: [{ name: LOG_FILE, task: "chat-test", task_id: "chat-test" }],
        response_type: "full",
      });
    }),

    // Log contents — return the full EvalLog (used by get_log_details and get_log_sample)
    http.get("*/api/logs/:file", () => {
      return HttpResponse.json(evalLog);
    }),

    // Log headers / summaries
    http.get("*/api/log-headers*", () => {
      return HttpResponse.json([
        {
          eval_id: logDetails.eval.eval_id,
          run_id: logDetails.eval.run_id,
          task: logDetails.eval.task,
          task_id: logDetails.eval.task_id,
          task_version: logDetails.eval.task_version,
          model: logDetails.eval.model,
          status: logDetails.status,
          started_at: logDetails.stats?.started_at,
          completed_at: logDetails.stats?.completed_at,
        },
      ]);
    })
  );

  // Navigate directly to the sample's Messages tab
  const encodedFile = encodeURIComponent(LOG_FILE);
  await page.goto(
    `/#/logs/${encodedFile}/samples/sample/${sampleId}/${epoch}/messages`
  );
}

/**
 * Asserts each text is visible and rendered below the previous one. Rows of
 * the virtual list are positioned absolutely, so DOM order alone doesn't
 * show screen order.
 */
async function expectTopToBottom(container: Locator, texts: string[]) {
  const tops: number[] = [];
  for (const text of texts) {
    const locator = container.getByText(text, { exact: true });
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, text).not.toBeNull();
    tops.push(box?.y ?? Number.NaN);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
}

// ---------------------------------------------------------------------------
// Basic message rendering
// ---------------------------------------------------------------------------

test.describe("chat message rendering", () => {
  for (const { layout, content } of [
    { layout: "inline", content: "Before $x+1$ after." },
    { layout: "display", content: "Before\n\n$$x+1$$\n\nafter." },
  ]) {
    test(`keeps ${layout} math in selected message text`, async ({
      page,
      network,
    }) => {
      await openSample(page, network, [
        { role: "assistant", content, source: "generate" },
      ]);

      const messagesArea = page.locator("#messages-contents");
      await expect(messagesArea.locator("mjx-container > svg")).toBeVisible();
      await expect(messagesArea.locator("mjx-assistive-mml")).toHaveCSS(
        "clip",
        "rect(1px, 1px, 1px, 1px)"
      );

      const selected = await messagesArea.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return selection?.toString();
      });

      expect(selected?.replace(/\s+/g, "")).toContain("Before𝑥+1after.");
    });
  }

  test("does not let a TeX \\style overlay cover the next message", async ({
    page,
    network,
  }) => {
    // Message markdown is HTML-escaped, so \style{} is the route by which log
    // content reaches an inline style attribute (on the assistive MathML).
    const overlay =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:#fff";
    await openSample(page, network, [
      {
        role: "assistant",
        content: `Overlay $\\style{${overlay}}{x}$ here.`,
        source: "generate",
      },
      {
        role: "user",
        content: "Second message stays readable",
        source: "input",
      },
    ]);

    const messagesArea = page.locator("#messages-contents");
    await expect(
      messagesArea.locator('mjx-assistive-mml [style*="100vh"]')
    ).toHaveCount(1);
    const target = messagesArea.getByText("Second message stays readable");
    await target.scrollIntoViewIfNeeded();
    const hit = await target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(
        box.left + 5,
        box.top + box.height / 2
      );
      return top === null || element.contains(top) || top.contains(element)
        ? "text"
        : top.tagName.toLowerCase();
    });
    expect(hit).toBe("text");
  });

  test("renders system message", async ({ page, network }) => {
    await openSample(page, network, [
      {
        role: "system",
        content: "You are a helpful assistant.",
        source: "input",
      },
      { role: "user", content: "Hello", source: "input" },
      { role: "assistant", content: "Hi there!", source: "generate" },
    ]);

    await expect(page.getByText("You are a helpful assistant.")).toBeVisible();
  });

  test("renders multi-turn conversation in order", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      { role: "user", content: "First question from user", source: "input" },
      {
        role: "assistant",
        content: "First response from assistant",
        source: "generate",
      },
      { role: "user", content: "Second question from user", source: "input" },
      {
        role: "assistant",
        content: "Second response from assistant",
        source: "generate",
      },
    ]);

    await expectTopToBottom(page.locator("#messages-contents"), [
      "First question from user",
      "First response from assistant",
      "Second question from user",
      "Second response from assistant",
    ]);
  });

  test("renders message with structured content array", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image:" },
          {
            type: "image",
            image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
            detail: "auto",
          },
        ],
        source: "input",
      },
      { role: "assistant", content: "I see an image.", source: "generate" },
    ]);

    await expect(page.getByText("Describe this image:")).toBeVisible();
    await expect(page.locator("img[src^='data:image']")).toBeVisible();
  });

  test("renders inline data images embedded in markdown", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      {
        role: "assistant",
        source: "generate",
        content: "![pixel](data:image/gif;base64,R0lGODlhAQABAAAAACw=)",
      },
    ]);

    await expect(page.locator("img[src^='data:image/gif']")).toHaveCount(1);
  });

  test("does not automatically load remote message media", async ({
    page,
    network,
  }) => {
    const mediaRequests: string[] = [];
    await page.context().route(`${MEDIA_ORIGIN}/**`, async (route) => {
      mediaRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>media</title>",
      });
    });

    await openSample(page, network, [
      {
        role: "assistant",
        source: "generate",
        content: [
          {
            type: "text",
            text: `![markdown image](${MEDIA_ORIGIN}/markdown.png)`,
          },
          {
            type: "image",
            image: `${MEDIA_ORIGIN}/image.png`,
            detail: "auto",
          },
          {
            type: "audio",
            audio: `${MEDIA_ORIGIN}/audio.mp3`,
            format: "mp3",
          },
          {
            type: "video",
            video: `${MEDIA_ORIGIN}/video.mp4`,
            format: "mp4",
          },
          {
            type: "document",
            document: `${MEDIA_ORIGIN}/document.png`,
            filename: "document.png",
            mime_type: "image/png",
            citations: false,
          },
        ],
      },
    ]);

    const markdownLink = page.locator(`a[href="${MEDIA_ORIGIN}/markdown.png"]`);
    await expect(markdownLink).toBeVisible();
    await expect(page.locator(`a[href^="${MEDIA_ORIGIN}/"]`)).toHaveCount(5);
    await expect(
      page.locator(
        `img[src^="${MEDIA_ORIGIN}/"], audio source[src^="${MEDIA_ORIGIN}/"], video source[src^="${MEDIA_ORIGIN}/"]`
      )
    ).toHaveCount(0);
    expect(mediaRequests).toEqual([]);

    const popupPromise = page.waitForEvent("popup");
    await markdownLink.click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");

    expect(mediaRequests).toEqual([`${MEDIA_ORIGIN}/markdown.png`]);
    await popup.close();
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
    await openSample(page, network, [
      {
        role: "user",
        content: "List the files in the current directory",
        source: "input",
      },
      {
        role: "assistant",
        content: "I'll check the directory contents.",
        source: "generate",
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
        content: "The directory contains file1.txt, file2.txt, and README.md.",
        source: "generate",
      },
    ]);

    // The tool call function name should appear
    await expect(page.getByText("bash", { exact: false })).toBeVisible();
    // The tool output should be visible
    await expect(page.getByText("file1.txt").first()).toBeVisible();
    await expect(page.getByText("README.md").first()).toBeVisible();
  });

  test("renders multiple tool calls from a single assistant message", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      { role: "user", content: "Check both files", source: "input" },
      {
        role: "assistant",
        content: "I'll read both files.",
        source: "generate",
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
        source: "generate",
      },
    ]);

    await expect(page.getByText("Contents of file one")).toBeVisible();
    await expect(page.getByText("Contents of file two")).toBeVisible();
  });

  test("renders tool call with error output", async ({ page, network }) => {
    await openSample(page, network, [
      { role: "user", content: "Run a command", source: "input" },
      {
        role: "assistant",
        content: "I'll try running it.",
        source: "generate",
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
        source: "generate",
      },
    ]);

    await expect(
      page.getByText("Permission denied", { exact: false })
    ).toBeVisible();
  });

  test("renders tool output containing JSON as structured view", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      { role: "user", content: "Get the config", source: "input" },
      {
        role: "assistant",
        content: "Reading config.",
        source: "generate",
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
      {
        role: "assistant",
        content: "Here is the config.",
        source: "generate",
      },
    ]);

    // Numbers are formatted with commas in the structured JSON view
    await expect(page.getByText("8,080").first()).toBeVisible();
    await expect(page.getByText("localhost").first()).toBeVisible();
  });

  test("renders python tool call with syntax-highlighted input", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      { role: "user", content: "Calculate something", source: "input" },
      {
        role: "assistant",
        content: "I'll compute that.",
        source: "generate",
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
      {
        role: "assistant",
        content: "The result is 4.",
        source: "generate",
      },
    ]);

    const code = page.locator("#messages-contents code.language-python");
    await expect(code).toHaveText(/result = 2 \+ 2\s*print\(result\)/);
    await expect(code.locator(".token.number").first()).toHaveText("2");
  });
});

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

test.describe("message content types", () => {
  test("renders reasoning content under a Reasoning title", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      { role: "user", content: "Think about this carefully", source: "input" },
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
          },
        ],
        source: "generate",
      },
    ]);

    const messagesArea = page.locator("#messages-contents");
    await expect(
      messagesArea.getByText("Reasoning", { exact: true })
    ).toBeVisible();
    await expect(
      messagesArea.getByText("Let me think step by step about this problem.")
    ).toBeVisible();
    await expect(
      messagesArea.getByText("After careful consideration, the answer is 42.")
    ).toBeVisible();
  });

  test("renders redacted reasoning with encrypted indicator", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      { role: "user", content: "Think about this", source: "input" },
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
          },
        ],
        source: "generate",
      },
    ]);

    await expect(page.getByText("Here is my answer.")).toBeVisible();
    await expect(
      page.getByText("Reasoning encrypted by model provider.")
    ).toBeVisible();
  });

  test("renders reasoning-like tags as literal assistant text", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      { role: "user", content: "Show the evidence", source: "input" },
      {
        role: "assistant",
        content:
          "Before <think>reasoning evidence</think> " +
          "<internal>legacy evidence</internal> " +
          "<content-internal>metadata evidence</content-internal> after.",
        source: "generate",
      },
    ]);

    const messagesArea = page.locator("#messages-contents");
    await expect(messagesArea.getByText("reasoning evidence")).toBeVisible();
    await expect(messagesArea.getByText("legacy evidence")).toBeVisible();
    await expect(messagesArea.getByText("metadata evidence")).toBeVisible();
  });
});

test.describe("Codex tool result display modes", () => {
  test("shows the projection when rendered and exact payload when raw", async ({
    page,
    network,
  }) => {
    const toolOutput = JSON.stringify({
      previous_status: {
        completed: "answer<content-internal>eyJ4IjoxfQ==</content-internal>",
      },
    });

    await openSample(page, network, [
      { role: "user", content: "Delegate this", source: "input" },
      {
        role: "assistant",
        content: "Closing the subagent.",
        source: "generate",
        id: "msg-a1",
        tool_calls: [
          {
            id: "call_close_agent",
            type: "function",
            function: "close_agent",
            arguments: { id: "agent-1" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_close_agent",
        function: "close_agent",
        content: toolOutput,
        id: "msg-t1",
      },
    ]);

    const messagesArea = page.locator("#messages-contents");
    await expect(
      messagesArea.getByText("answer", { exact: true })
    ).toBeVisible();
    await expect(messagesArea).not.toContainText("content-internal");

    await page.getByRole("button", { name: "Raw" }).click();

    await expect(
      messagesArea.getByText(toolOutput, { exact: true })
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Inspect-specific features
// ---------------------------------------------------------------------------

test.describe("inspect-specific features", () => {
  test("renders reasoning summary when reasoning is redacted with summary", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      { role: "user", content: "Think carefully", source: "input" },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            reasoning: "",
            signature: "sig123",
            redacted: true,
            summary:
              "The model considered multiple approaches before deciding.",
          },
          {
            type: "text",
            text: "Here is the final answer.",
          },
        ],
        source: "generate",
      },
    ]);

    await expect(page.getByText("Here is the final answer.")).toBeVisible();
    // When redacted with a summary, title should say "Reasoning (Summary)"
    await expect(
      page.getByText("Reasoning (Summary)", { exact: false }).first()
    ).toBeVisible();
    // The summary text should be visible
    await expect(
      page.getByText("considered multiple approaches", { exact: false }).first()
    ).toBeVisible();
  });

  test("renders shell_command tool with command argument", async ({
    page,
    network,
  }) => {
    await openSample(page, network, [
      {
        role: "user",
        content: "List the running processes",
        source: "input",
      },
      {
        role: "assistant",
        content: "I'll check the running processes.",
        source: "generate",
        id: "msg-a1",
        tool_calls: [
          {
            id: "call_sc",
            type: "function",
            function: "shell_command",
            arguments: {
              command: "ps aux | head -5",
              description: "List top 5 running processes",
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_sc",
        content: "USER  PID  %CPU  %MEM\nroot  1    0.0   0.1",
        id: "msg-t-sc",
      },
      {
        role: "assistant",
        content: "Here are the running processes.",
        source: "generate",
      },
    ]);

    const messagesArea = page.locator("#messages-contents");
    await expect(messagesArea.getByText("ps aux | head -5")).toBeVisible();
    await expect(messagesArea.getByText(/USER\s+PID/)).toBeVisible();
  });
});
