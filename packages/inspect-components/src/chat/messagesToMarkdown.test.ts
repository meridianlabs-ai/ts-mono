import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testToolCall,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { ContentReasoning } from "@tsmono/inspect-common/types";

import { messagesToMarkdown } from "./messagesToMarkdown";

const reasoningContent = (
  overrides: Partial<ContentReasoning> = {}
): ContentReasoning => ({
  type: "reasoning",
  reasoning: "",
  redacted: false,
  ...overrides,
});

describe("messagesToMarkdown", () => {
  it("renders one section per message titled by role", () => {
    expect(
      messagesToMarkdown([
        testUserMessage({ content: "What is 2+2?" }),
        testAssistantMessage({ content: "4" }),
      ])
    ).toBe("## User\n\nWhat is 2+2?\n\n---\n\n## Assistant\n\n4");
  });

  it("keeps prose Markdown and fences tool calls with their arguments", () => {
    const md = messagesToMarkdown([
      testAssistantMessage({
        content: "Let me check.",
        tool_calls: [
          testToolCall({
            id: "c-1",
            function: "bash",
            arguments: { cmd: "ls" },
          }),
        ],
      }),
    ]);
    expect(md).toBe(
      '## Assistant\n\nLet me check.\n\n**Tool call: bash**\n\n```\n{\n  "cmd": "ls"\n}\n```'
    );
  });

  it("titles tool messages by function and fences the result verbatim", () => {
    const md = messagesToMarkdown([
      testToolMessage({
        content: "file.txt",
        tool_call_id: "c-1",
        function: "bash",
      }),
    ]);
    expect(md).toBe("## Tool: bash\n\n```\nfile.txt\n```");
  });

  it("gives an empty message its heading so the export never shortens", () => {
    expect(messagesToMarkdown([testAssistantMessage({ content: "" })])).toBe(
      "## Assistant"
    );
  });

  it("renders reasoning summaries but never raw redacted chains", () => {
    const md = messagesToMarkdown([
      testAssistantMessage({
        content: [
          reasoningContent({
            reasoning: "OPAQUE",
            summary: "Reading the instructions.",
            redacted: true,
          }),
        ],
      }),
    ]);
    expect(md).toContain("Reading the instructions.");
    expect(md).not.toContain("OPAQUE");
  });

  it("labels reasoning and quotes it so it reads apart from the reply", () => {
    const md = messagesToMarkdown([
      testAssistantMessage({
        content: [
          reasoningContent({ reasoning: "Check the parity.\n\nIt is even." }),
          { type: "text", text: "The answer is 4." },
        ],
      }),
    ]);
    expect(md).toBe(
      "## Assistant\n\n**Reasoning**\n\n> Check the parity.\n> \n> It is even.\n\nThe answer is 4."
    );
  });

  it("titles a summary shown in place of reasoning as the chat view does", () => {
    const redacted = messagesToMarkdown([
      testAssistantMessage({
        content: [
          reasoningContent({
            reasoning: "OPAQUE",
            summary: "Plan.",
            redacted: true,
          }),
        ],
      }),
    ]);
    const missing = messagesToMarkdown([
      testAssistantMessage({
        content: [reasoningContent({ summary: "Plan." })],
      }),
    ]);
    for (const md of [redacted, missing]) {
      expect(md).toBe("## Assistant\n\n**Reasoning (Summary)**\n\n> Plan.");
    }
  });

  it("lengthens the fence past backtick runs in the value", () => {
    const md = messagesToMarkdown([
      testToolMessage({ content: "```\ncode\n```", tool_call_id: "c-1" }),
    ]);
    expect(md).toContain("````\n```\ncode\n```\n````");
  });

  it("joins sections with a rule and renders nothing for no messages", () => {
    expect(messagesToMarkdown([])).toBe("");
    const md = messagesToMarkdown([
      testUserMessage({ content: "a" }),
      testUserMessage({ content: "b" }),
    ]);
    expect(md).toBe("## User\n\na\n\n---\n\n## User\n\nb");
  });
});
