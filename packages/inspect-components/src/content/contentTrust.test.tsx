// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComponentIconProvider,
  ComponentNavigationProvider,
  ContentPolicyProvider,
  ContentTrustCeilingProvider,
  ContentTrustProvider,
  richContentPolicy,
  type ContentTrust,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  makeStateHooks,
  ResizeObserverStub,
  testIcons,
} from "@tsmono/react/testing";

import { ContentDataView } from "../chat/content-data/ContentDataView";
import { MessageContent } from "../chat/MessageContent";
import { ServerToolCall } from "../chat/server-tools/ServerToolCall";

import { ContentRenderersContext } from "./ContentRenderersContext";
import { DisplayModeContext, useDisplayMode } from "./DisplayModeContext";
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
    "preserves JSON strings literally under the %s ceiling",
    (scope) => {
      const source =
        '  {"result":"first","result":"second","label":"\u202Egnp.exe"}\n';
      const { container } = render(
        withTrust(
          scope === "task" ? "untrusted" : "trusted",
          <ContentTrustCeilingProvider
            value={scope === "viewer" ? "untrusted" : "trusted"}
          >
            <RenderedContent
              id="metadata"
              entry={{ name: "result", value: source }}
            />
          </ContentTrustCeilingProvider>
        )
      );
      expect(container.textContent).toBe(source.replace("\u202E", "⟨U+202E⟩"));
      expect(
        container.querySelector(".token, a, .markdown-content")
      ).toBeNull();
    }
  );

  it.each(["task", "viewer"] as const)(
    "preserves provider tool arguments and every result field under the %s ceiling",
    (scope) => {
      const args = '  {"code":"first","code":"second"}\n';
      const result =
        '{"content":{"stdout":"\u202Eoutput","stderr":"error","return_code":0,"extra":"retain me"},"other":"retain this too"}';
      const { container } = render(
        withTrust(
          scope === "task" ? "untrusted" : "trusted",
          <ContentTrustCeilingProvider
            value={scope === "viewer" ? "untrusted" : "trusted"}
          >
            <ServerToolCall
              id="exec"
              content={{
                type: "tool_use",
                id: "call",
                name: "exec\u202Ename",
                tool_type: "code_execution",
                arguments: args,
                result,
              }}
            />
          </ContentTrustCeilingProvider>
        )
      );
      expect(container.textContent).toContain(args);
      expect(container.textContent).toContain(
        result.replace("\u202E", "⟨U+202E⟩")
      );
      expect(container.textContent).toContain("exec⟨U+202E⟩name");
      expect(
        container.querySelector(".token, a, .markdown-content")
      ).toBeNull();
    }
  );

  it("does not probe or invoke custom renderers when their permissions are unavailable", () => {
    const canRender = vi.fn(() => true);
    const customRender = vi.fn(() => ({
      rendered: <a href="https://example.com">custom</a>,
    }));
    const { container } = render(
      withTrust(
        "trusted",
        <ContentPolicyProvider value={{ ...richContentPolicy, links: false }}>
          <ContentRenderersContext.Provider
            value={{
              renderers: {
                custom: { bucket: -1, canRender, render: customRender },
              },
            }}
          >
            <RenderedContent id="custom" entry={{ name: "data", value: 42 }} />
          </ContentRenderersContext.Provider>
        </ContentPolicyProvider>
      )
    );
    expect(canRender).not.toHaveBeenCalled();
    expect(customRender).not.toHaveBeenCalled();
    expect(container.textContent).toBe("42");
  });

  it("retains fields normally omitted by a specialized content-data view", () => {
    const { container } = render(
      withTrust(
        "untrusted",
        <ContentDataView
          id="data"
          contentData={{
            type: "data",
            data: {
              type: "server_tool_use",
              name: "web_search",
              input: { query: "query" },
              additional: "keep me",
            },
          }}
        />
      )
    );
    expect(container.textContent).toContain("additional");
    expect(container.textContent).toContain("keep me");
  });

  it("keeps custom renderers available under the full rendering policy", () => {
    const customRender = vi.fn(() => ({
      rendered: <a href="https://example.com">custom view</a>,
    }));
    const { container } = render(
      withTrust(
        "trusted",
        <ContentRenderersContext.Provider
          value={{
            renderers: {
              custom: {
                bucket: -1,
                canRender: () => true,
                render: customRender,
              },
            },
          }}
        >
          <RenderedContent id="custom" entry={{ name: "data", value: 42 }} />
        </ContentRenderersContext.Provider>
      )
    );
    expect(customRender).toHaveBeenCalledOnce();
    expect(container.querySelector("a")?.textContent).toBe("custom view");
  });

  it("keeps the provider execution view under the full rendering policy", () => {
    const { container } = render(
      withTrust(
        "trusted",
        <ServerToolCall
          id="exec"
          content={{
            type: "tool_use",
            id: "call",
            name: "exec",
            tool_type: "code_execution",
            arguments: '{"code":"print(1)"}',
            result:
              '{"content":{"stdout":"execution output","stderr":"failure output","return_code":9}}',
          }}
        />
      )
    );
    expect(container.textContent).toContain("execution output");
    expect(container.textContent).toContain("failure output");
    expect(container.textContent).toContain("exit code 9");
    expect(container.textContent).not.toContain('"stdout"');
  });
  it("retains the display preference without granting rendering permission", () => {
    const Mode = () => <span>{useDisplayMode()}</span>;
    const { container } = render(withTrust("untrusted", <Mode />));
    expect(container.textContent).toBe("rendered");
  });

  it("keeps the requested display mode for trusted content", () => {
    const Mode = () => <span>{useDisplayMode()}</span>;
    const { container } = render(withTrust("trusted", <Mode />));
    expect(container.textContent).toBe("rendered");
  });

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
          href={"https://example.com/\u202Egnp.exe"}
          title={"https://example.com/\u202Egnp.exe"}
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
