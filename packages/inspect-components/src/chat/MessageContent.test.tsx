// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ContentData,
  ContentText,
  ContentToolUse,
} from "@tsmono/inspect-common/types";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  makeStateHooks,
  ResizeObserverStub,
  testIcons,
} from "@tsmono/react/testing";

import { DisplayModeContext } from "../content/DisplayModeContext";

import { MessageContent } from "./MessageContent";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

type Contents = ComponentProps<typeof MessageContent>["contents"];

const renderMessage = (
  contents: Contents,
  displayMode: "rendered" | "raw" = "rendered"
) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <DisplayModeContext.Provider value={{ displayMode }}>
            <MessageContent contents={contents} />
          </DisplayModeContext.Provider>
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

afterEach(() => {
  cleanup();
});

describe("MessageContent evidence fidelity", () => {
  it("renders reasoning-like tags and their contents as literal text", async () => {
    const text =
      'before <think signature="sig">reasoning</think> ' +
      "<internal>legacy</internal> " +
      "<content-internal>metadata</content-internal> after";
    const { container } = renderMessage(text);

    await waitFor(() => {
      expect(container.textContent).toContain(text);
    });
    expect(container.querySelector("think")).toBeNull();
    expect(container.querySelector("internal")).toBeNull();
    expect(container.querySelector("content-internal")).toBeNull();
  });

  it("preserves raw JSON text, whitespace, and tag delimiters", () => {
    const text = ' \n{"value":"<think>literal</think>"}\n ';
    const { container } = renderMessage(text, "raw");

    expect(container.querySelector("pre")?.textContent).toBe(text);
  });

  it("marks the last rendered block as last after text blocks merge", async () => {
    // Rendered mode collapses consecutive text blocks, so "last" must be
    // judged against the merged list, not the original contents length.
    const text = (t: string): ContentText => ({
      type: "text",
      text: t,
      citations: null,
    });
    const { container } = renderMessage([text("first"), text("second")]);

    await waitFor(() => {
      expect(container.textContent).toContain("second");
    });
    expect(container.querySelector(".no-last-para-padding")).not.toBeNull();
  });

  it("does not inject citation markers into raw text", () => {
    const content: ContentText = {
      type: "text",
      text: "cited text",
      citations: [
        {
          type: "url",
          url: "https://example.test/source",
          title: "Source",
          cited_text: [0, 5],
        },
      ],
    };
    const { container } = renderMessage([content], "raw");

    expect(container.querySelector("pre")?.textContent).toBe(content.text);
    expect(container.querySelector("sup")).toBeNull();
  });
});

// Every href a log author can place in a chat message must be an absolute
// http(s) URL; anything else renders as inert text rather than handing the
// reviewer a link to a local file or a custom protocol handler.
describe("MessageContent log-supplied link hrefs", () => {
  const rejectedUrls = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "blob:https://example.test/id",
    "vscode://file/etc/passwd",
    "ms-msdt:/id",
    "custom://asset/1",
    "/relative/path",
    "//example.test/protocol-relative",
  ];

  const citationText = (url: string): ContentText => ({
    type: "text",
    text: "cited text",
    citations: [{ type: "url", url, title: "Source" }],
  });

  const webSearchToolUse = (url: string): ContentToolUse => ({
    type: "tool_use",
    id: "srvtoolu_1",
    name: "web_search",
    tool_type: "web_search",
    arguments: JSON.stringify({ query: "q" }),
    result: JSON.stringify([
      { type: "web_search_result", title: "Result", url },
    ]),
  });

  const webSearchToolResult = (url: string): ContentData => ({
    type: "data",
    data: {
      type: "web_search_tool_result",
      content: [{ title: "Result", url, page_age: "1 day ago" }],
    },
  });

  const sinks = [
    ["citation", citationText, "Source"],
    ["web_search tool result", webSearchToolUse, "Result"],
    ["web_search_tool_result data", webSearchToolResult, "Result"],
  ] as const;

  describe.each(sinks)("%s", (_label, build, label) => {
    it("links an absolute http(s) URL in a new tab", async () => {
      const { container } = renderMessage([
        build("https://example.test/source?q=1"),
      ]);

      await waitFor(() => {
        expect(container.textContent).toContain(label);
      });
      const anchor = container.querySelector("a");
      expect(anchor?.getAttribute("href")).toBe(
        "https://example.test/source?q=1"
      );
      expect(anchor?.getAttribute("target")).toBe("_blank");
      expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it.each(rejectedUrls)("renders %s as text, not a link", async (url) => {
      const { container } = renderMessage([build(url)]);

      await waitFor(() => {
        expect(container.textContent).toContain(label);
      });
      expect(container.querySelector("a")).toBeNull();
    });
  });
});
