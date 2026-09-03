// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ContentText } from "@tsmono/inspect-common/types";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { DisplayModeContext } from "../content/DisplayModeContext";

import { MessageContent } from "./MessageContent";

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
