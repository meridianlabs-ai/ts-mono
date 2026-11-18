import { describe, expect, it } from "vitest";

import { testAssistantMessage } from "@tsmono/inspect-common/testing";
import type { ContentToolUse } from "@tsmono/inspect-common/types";

import { messageSearchText } from "./messageSearchText";

const toolUse = (fields: Partial<ContentToolUse>): ContentToolUse => ({
  type: "tool_use",
  tool_type: "web_search",
  id: "srvtoolu_1",
  name: "web_search",
  arguments: '{"query":"capital of france"}',
  result: "",
  ...fields,
});

const searchText = (content: ContentToolUse): string[] =>
  messageSearchText({
    message: testAssistantMessage({ content: [content] }),
    toolMessages: [],
  });

const finds = (texts: string[], needle: string) =>
  texts.some((text) => text.includes(needle));

// Find indexes what ServerToolCall renders, never the raw JSON behind it.
describe("messageSearchText", () => {
  it("finds a web search's query and result titles as shown", () => {
    const texts = searchText(
      toolUse({
        // Python's json.dumps escapes quotes and non-ASCII.
        result:
          '[{"type":"web_search_result","title":"He said \\"hi\\"","url":"https://x.test/a","page_age":"2 days"},' +
          '{"type":"web_search_result","title":"Caf\\u00e9 guide","url":"https://x.test/b"}]',
      })
    );
    expect(finds(texts, "web_search")).toBe(true);
    expect(finds(texts, "capital of france")).toBe(true);
    expect(finds(texts, 'He said "hi"')).toBe(true);
    expect(finds(texts, "Café guide")).toBe(true);
    for (const hidden of ['"query"', "title", "page_age", "x.test"]) {
      expect(finds(texts, hidden)).toBe(false);
    }
  });

  it("finds only the error of an errored call", () => {
    const texts = searchText(
      toolUse({
        result: '[{"title":"Hidden result","url":"https://x.test/a"}]',
        error: "rate limited",
      })
    );
    expect(finds(texts, "rate limited")).toBe(true);
    expect(finds(texts, "Hidden result")).toBe(false);
  });

  it("finds a result shown as text", () => {
    const texts = searchText(
      toolUse({ result: "Paris is the capital and largest city of France." })
    );
    expect(finds(texts, "largest city of France")).toBe(true);
  });

  it("finds listed tools by name and description, not schema", () => {
    const texts = searchText(
      toolUse({
        tool_type: "mcp_call",
        name: "mcp_list_tools",
        arguments: "{}",
        result: JSON.stringify([
          {
            name: "lookup",
            description: "Looks things up",
            input_schema: { properties: { needle: { type: "string" } } },
          },
        ]),
      })
    );
    expect(finds(texts, "lookup")).toBe(true);
    expect(finds(texts, "Looks things up")).toBe(true);
    expect(finds(texts, "needle")).toBe(false);
  });

  it("finds code execution output, not its payload keys", () => {
    const texts = searchText(
      toolUse({
        tool_type: "code_execution",
        name: "code_execution",
        arguments: '{"code":"print(1)\\nprint(2)"}',
        result: JSON.stringify({
          content: { stdout: "out text", stderr: "err text", return_code: 0 },
        }),
      })
    );
    expect(finds(texts, "print(1)\nprint(2)")).toBe(true);
    expect(finds(texts, "out text")).toBe(true);
    expect(finds(texts, "err text")).toBe(true);
    expect(finds(texts, "return_code")).toBe(false);
  });

  // The chat view never shows the `<image />` placeholder, so Find can't land
  // on it.
  it("adds nothing for media content", () => {
    const texts = messageSearchText({
      message: testAssistantMessage({
        content: [
          { type: "text", text: "a picture" },
          {
            type: "image",
            image: "data:image/png;base64,AAAA",
            detail: "auto",
          },
        ],
      }),
      toolMessages: [],
    });
    expect(texts).toEqual(["a picture"]);
  });
});
