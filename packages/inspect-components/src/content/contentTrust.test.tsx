// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  testApprovalEvent,
  testAssistantMessage,
  testReviewEvent,
  testSandboxEvent,
  testToolCall,
  testToolEvent,
  testToolMessage,
} from "@tsmono/inspect-common/testing";
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

import { ChatMessage } from "../chat/ChatMessage";
import { ChatMessageRow } from "../chat/ChatMessageRow";
import { ContentDataView } from "../chat/content-data/ContentDataView";
import { MessageCitations } from "../chat/MessageCitations";
import { MessageContent } from "../chat/MessageContent";
import { ServerToolCall } from "../chat/server-tools/ServerToolCall";
import { ToolInput } from "../chat/tools/ToolInput";
import { deriveActivityData } from "../sample-activity/activityData";
import { ActivityTooltip } from "../sample-activity/ActivityTooltip";
import { ApprovalEventView } from "../transcript/ApprovalEventView";
import { ReviewEventView } from "../transcript/ReviewEventView";
import { SandboxEventView } from "../transcript/SandboxEventView";
import { ToolEventView } from "../transcript/ToolEventView";
import { EventNode } from "../transcript/types";

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

describe("literal payload dispatch", () => {
  const plain = (scope: "task" | "viewer", ui: ReactNode) =>
    withTrust(
      scope === "task" ? "untrusted" : "trusted",
      <ContentTrustCeilingProvider
        value={scope === "viewer" ? "untrusted" : "trusted"}
      >
        {ui}
      </ContentTrustCeilingProvider>
    );
  it.each(["task", "viewer"] as const)(
    "preserves citation source under the %s ceiling",
    (scope) => {
      const source = "&lt;literal&gt; \u202Egnp.exe";
      const { container } = render(
        plain(
          scope,
          <MessageCitations citations={[{ type: "document", title: source }]} />
        )
      );
      expect(container.textContent).toBe(
        "1" + source.replace("\u202E", "⟨U+202E⟩")
      );
    }
  );
  it.each(["task", "viewer"] as const)(
    "preserves explanation and file whitespace under the %s ceiling",
    (scope) => {
      const source = "  \u202Erationale  ";
      const { container } = render(
        plain(
          scope,
          <>
            <ApprovalEventView
              eventNode={
                new EventNode(
                  "approval",
                  testApprovalEvent({ explanation: source }),
                  0
                )
              }
            />
            <ReviewEventView
              eventNode={
                new EventNode(
                  "review",
                  testReviewEvent({ explanation: source }),
                  0
                )
              }
            />
            <SandboxEventView
              eventNode={
                new EventNode(
                  "file",
                  testSandboxEvent({
                    action: "read_file",
                    file: "file\u202E.txt",
                    output: source,
                  }),
                  0
                )
              }
            />
            <SandboxEventView
              eventNode={
                new EventNode(
                  "exec",
                  testSandboxEvent({
                    action: "exec",
                    cmd: "cmd\u202E",
                    input: source,
                    output: source,
                    result: 0,
                  }),
                  0
                )
              }
            />
          </>
        )
      );
      expect(
        container.textContent.match(/ {2}⟨U\+202E⟩rationale {2}/g)
      ).toHaveLength(5);
      expect(container.textContent).toContain("file⟨U+202E⟩.txt");
      expect(container.textContent).toContain("cmd⟨U+202E⟩");
      expect(container.textContent).not.toContain("\u202E");
    }
  );
  it.each(["task", "viewer"] as const)(
    "retains every client argument in both messages and transcript under the %s ceiling",
    (scope) => {
      const args = { cmd: "  first\nsecond  ", timeout: 99, extra: false };
      const call = testToolCall({
        function: "bash",
        arguments: args,
        view: {
          title: "formatted",
          format: "markdown",
          content: "replacement",
        },
      });
      const { container } = render(
        plain(
          scope,
          <>
            <ChatMessageRow
              index={0}
              parentName="chat"
              resolvedMessage={{
                message: testAssistantMessage({
                  content: "",
                  tool_calls: [call],
                }),
                toolMessages: [],
              }}
              tools={{ callStyle: "compact" }}
            />
            <ToolEventView
              eventNode={
                new EventNode(
                  "tool",
                  testToolEvent({
                    function: "bash",
                    arguments: args,
                    view: call.view,
                  }),
                  0
                )
              }
              childNodes={[]}
            />
          </>
        )
      );
      const inputs = Array.from(container.querySelectorAll(".tool-call-input"));
      expect(inputs).toHaveLength(2);
      for (const input of inputs)
        expect(input.textContent).toBe(JSON.stringify(args));
      expect(container.textContent).not.toContain("replacement");
      expect(container.textContent).not.toContain("formatted");
    }
  );
  it.each([0, false, null])("retains scalar tool input %s", (value) => {
    const { container } = render(
      withTrust("untrusted", <ToolInput contents={value} />)
    );
    expect(container.textContent).toBe(JSON.stringify(value));
  });
  it("reveals hidden characters in activity tool details", () => {
    const data = deriveActivityData({
      events: [
        testToolEvent({
          function: "tool\u202E",
          arguments: { arg: "  argument\u202E\nnext  " },
          error: { type: "unknown", message: "error\u202E" },
          working_time: 1,
        }),
      ],
    });
    const row = data.agentRows[0]!;
    const span = row.spans[0]!;
    const { container } = render(
      withTrust(
        "untrusted",
        <ActivityTooltip target={{ kind: "span", row, span }} />
      )
    );
    expect(container.textContent).toContain("  argument⟨U+202E⟩\nnext  ");
    expect(container.textContent).toContain("error⟨U+202E⟩");
    expect(container.textContent).not.toContain("\u202E");
  });
});

it("retains known structured and reasoning content in plain tool messages", () => {
  const { container } = render(
    withTrust(
      "untrusted",
      <ChatMessage
        id="tool"
        message={testToolMessage({
          content: [
            { type: "data", data: { additional: "keep this data" } },
            {
              type: "reasoning",
              reasoning: "keep this reasoning",
              redacted: false,
            },
          ],
        })}
      />
    )
  );
  expect(container.textContent).toContain("keep this data");
  expect(container.textContent).toContain("keep this reasoning");
});
