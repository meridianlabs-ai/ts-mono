// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComponentIconProvider,
  ComponentNavigationProvider,
  ContentTrustCeilingProvider,
  ContentTrustProvider,
  type ContentTrust,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  makeStateHooks,
  ResizeObserverStub,
  testIcons,
} from "@tsmono/react/testing";

import { MessageContent } from "../chat/MessageContent";
import { ToolCallView } from "../chat/tools/ToolCallView";

import { ContentRenderersContext } from "./ContentRenderersContext";
import { DisplayModeContext } from "./DisplayModeContext";
import { ExternalLink } from "./ExternalLink";
import { logContentTrust, trustContentSetting } from "./logContentTrust";
import { RenderedContent } from "./RenderedContent";
import { RenderedText } from "./RenderedText";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

afterEach(() => {
  cleanup();
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const withTrust = (trust: ContentTrust, ui: ReactNode) => (
  <ComponentStateProvider hooks={makeStateHooks()}>
    <ComponentIconProvider icons={testIcons}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <ContentTrustProvider value={trust}>
          <DisplayModeContext.Provider value={{ displayMode: "rendered" }}>
            {ui}
          </DisplayModeContext.Provider>
        </ContentTrustProvider>
      </ComponentNavigationProvider>
    </ComponentIconProvider>
  </ComponentStateProvider>
);

describe("logContentTrust", () => {
  it.each([
    ["an unloaded header", undefined, "untrusted"],
    ["a header without viewer config", { eval: {} }, "trusted"],
    ["a null viewer config", { eval: { viewer: null } }, "trusted"],
    ["an unset trust_content", { eval: { viewer: {} } }, "trusted"],
    [
      "a null trust_content",
      { eval: { viewer: { trust_content: null } } },
      "trusted",
    ],
    [
      "trust_content true",
      { eval: { viewer: { trust_content: true } } },
      "trusted",
    ],
    [
      "trust_content false",
      { eval: { viewer: { trust_content: false } } },
      "untrusted",
    ],
    [
      "an unrecognized trust_content",
      { eval: { viewer: { trust_content: "safe" } } },
      "untrusted",
    ],
    ["a malformed viewer config", { eval: { viewer: "oops" } }, "untrusted"],
  ] as const)("treats %s as %s", (_name, header, expected) => {
    expect(logContentTrust(header)).toBe(expected);
  });
});

describe("trustContentSetting", () => {
  it.each([
    [undefined, "trusted"],
    [null, "trusted"],
    [true, "trusted"],
    [false, "untrusted"],
    ["false", "untrusted"],
    ["safe", "untrusted"],
  ] as const)("treats %s as %s", (value, expected) => {
    expect(trustContentSetting(value)).toBe(expected);
  });
});

describe("untrusted content rendering", () => {
  it.each(["task", "viewer"] as const)(
    "shows markdown as source text under the %s setting",
    (scope) => {
      const source = "**bold** [link](https://example.com) ‮gnp.exe";
      const { container } = render(
        withTrust(
          scope === "task" ? "untrusted" : "trusted",
          <ContentTrustCeilingProvider
            value={scope === "viewer" ? "untrusted" : "trusted"}
          >
            <RenderedContent
              id="metadata"
              entry={{ name: "note", value: source }}
            />
          </ContentTrustCeilingProvider>
        )
      );
      expect(container.textContent).toBe(source.replace("‮", "⟨U+202E⟩"));
      expect(
        container.querySelector("a, strong, .markdown-content")
      ).toBeNull();
    }
  );

  it("ignores forceRender for untrusted text", () => {
    const { container } = render(
      withTrust(
        "untrusted",
        <RenderedText
          markdown={"**bold** [x](https://example.com)"}
          forceRender
        />
      )
    );
    expect(container.querySelector("pre")?.textContent).toBe(
      "**bold** [x](https://example.com)"
    );
    expect(container.querySelector("a, strong")).toBeNull();
  });

  it.each(["trusted", "untrusted"] as const)(
    "truncates a very long %s text without a 'truncated' notice",
    (trust) => {
      const { container } = render(
        withTrust(
          trust,
          <RenderedText markdown={"word ".repeat(100_000)} truncateAt={250} />
        )
      );
      expect(container.textContent).not.toContain("Output truncated");
      expect(container.textContent.length).toBeLessThan(300);
    }
  );

  it("renders links as plain text that shows the destination", () => {
    const { container } = render(
      withTrust(
        "untrusted",
        <ExternalLink
          href={"https://example.com/‮gnp.exe"}
          title={"https://example.com/‮gnp.exe"}
        >
          click me
        </ExternalLink>
      )
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe(
      "click me (https://example.com/⟨U+202E⟩gnp.exe)"
    );
    expect(container.querySelector("span")?.getAttribute("title")).toBe(
      "https://example.com/⟨U+202E⟩gnp.exe"
    );
  });

  it("doesn't repeat a destination that is already the link text", () => {
    const { container } = render(
      withTrust(
        "untrusted",
        <ExternalLink href="https://example.com">
          https://example.com
        </ExternalLink>
      )
    );
    expect(container.textContent).toBe("https://example.com");
  });

  it("withholds message images, audio and video", () => {
    const { container } = render(
      withTrust(
        "untrusted",
        <MessageContent
          contents={[
            { type: "image", image: PNG, detail: "auto" },
            {
              type: "audio",
              audio: "data:audio/wav;base64,AAAA",
              format: "wav",
            },
            {
              type: "video",
              video: "data:video/mp4;base64,AAAA",
              format: "mp4",
            },
          ]}
        />
      )
    );
    expect(container.querySelector("img, audio, video")).toBeNull();
    const kinds = Array.from(
      container.querySelectorAll("[data-untrusted-placeholder]")
    ).map((el) => el.getAttribute("data-untrusted-placeholder"));
    expect(kinds).toEqual(["image", "audio", "video"]);
  });
});

describe("custom renderers", () => {
  const renderWithCustomRenderer = (trust: ContentTrust) => {
    const canRender = vi.fn(() => true);
    const customRender = vi.fn(() => ({
      rendered: <a href="https://example.com">custom view</a>,
    }));
    const { container } = render(
      withTrust(
        trust,
        <ContentRenderersContext.Provider
          value={{
            renderers: {
              custom: { bucket: -1, canRender, render: customRender },
            },
          }}
        >
          <RenderedContent id="custom" entry={{ name: "data", value: 42 }} />
        </ContentRenderersContext.Provider>
      )
    );
    return { container, canRender, customRender };
  };

  it("are neither probed nor invoked for untrusted content", () => {
    const { container, canRender, customRender } =
      renderWithCustomRenderer("untrusted");
    expect(canRender).not.toHaveBeenCalled();
    expect(customRender).not.toHaveBeenCalled();
    expect(container.textContent).toBe("42");
  });

  it("render trusted content", () => {
    const { container, customRender } = renderWithCustomRenderer("trusted");
    expect(customRender).toHaveBeenCalledOnce();
    expect(container.querySelector("a")?.textContent).toBe("custom view");
  });

  it.each([
    ["trusted", 1],
    ["untrusted", 0],
  ] as const)("custom tool views run for %s content", (trust, calls) => {
    const getCustomToolView = vi.fn(() => <div>custom tool view</div>);
    render(
      withTrust(
        trust,
        <ToolCallView
          id="call"
          tool="bash"
          functionCall="bash"
          input="ls"
          output="files"
          getCustomToolView={getCustomToolView}
        />
      )
    );
    expect(getCustomToolView).toHaveBeenCalledTimes(calls);
  });
});

it("reveals hidden characters in the tool call header", () => {
  const { container } = render(
    withTrust(
      "untrusted",
      <ToolCallView
        id="tool"
        tool={"read‮gnp.exe"}
        functionCall={"read‮gnp.exe"}
        description={"desc‮"}
        output=""
      />
    )
  );
  expect(container.textContent).toContain("read⟨U+202E⟩gnp.exe");
  expect(container.textContent).toContain("desc⟨U+202E⟩");
  expect(container.textContent).not.toContain("‮");
});
