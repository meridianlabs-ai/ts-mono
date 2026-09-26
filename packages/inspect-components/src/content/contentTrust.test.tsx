// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComponentIconProvider,
  ComponentNavigationProvider,
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

import { DisplayModeContext, useDisplayMode } from "./DisplayModeContext";
import { ExternalLink } from "./ExternalLink";
import { logContentTrust } from "./logContentTrust";
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

describe("untrusted content rendering", () => {
  it("forces the raw display mode", () => {
    const Mode = () => <span>{useDisplayMode()}</span>;
    const { container } = render(withTrust("untrusted", <Mode />));
    expect(container.textContent).toBe("raw");
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
