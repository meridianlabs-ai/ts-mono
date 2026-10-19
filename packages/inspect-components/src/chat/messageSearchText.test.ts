import { describe, expect, it } from "vitest";

import { testAssistantMessage } from "@tsmono/inspect-common/testing";
import type { ContentToolUse } from "@tsmono/inspect-common/types";

import { messageSearchText } from "./messageSearchText";

const serverToolUse: ContentToolUse = {
  type: "tool_use",
  tool_type: "web_search",
  id: "srvtoolu_1",
  name: "web_search",
  arguments: '{"query":"capital of france"}',
  result: "Paris is the capital and largest city of France.",
  error: "partial results: rate limited",
};

describe("messageSearchText", () => {
  it("finds a server-side tool's name, arguments, result and error", () => {
    const texts = messageSearchText({
      message: testAssistantMessage({ content: [serverToolUse] }),
      toolMessages: [],
    });
    const has = (needle: string) => texts.some((t) => t.includes(needle));
    expect(has("web_search")).toBe(true);
    expect(has("capital of france")).toBe(true);
    expect(has("largest city of France")).toBe(true);
    expect(has("rate limited")).toBe(true);
  });

  // The match counter compares the query as typed, so arguments must stay the
  // JSON string they already are, not be stringified again into \"escapes\".
  it("keeps tool arguments as the JSON string they already are", () => {
    const texts = messageSearchText({
      message: testAssistantMessage({ content: [serverToolUse] }),
      toolMessages: [],
    });
    expect(texts).toContain('{"query":"capital of france"}');
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
