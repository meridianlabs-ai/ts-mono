// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ANSIDisplay } from "./AnsiDisplay";
import { AsciinemaPlayer } from "./AsciinemaPlayer";
import { richContentPolicy } from "./contentRenderingPolicy";
import {
  ContentText,
  RequireMedia,
  untrustedTextClassName,
} from "./ContentTrust";
import {
  ContentPolicyCeilingProvider,
  ContentPolicyProvider,
  ContentTrustCeilingProvider,
  ContentTrustProvider,
  useContentPolicy,
  useHasAllContentPermissions,
} from "./ContentTrustContext";
import { JSONPanel } from "./JsonPanel";
import { MarkdownDiv } from "./MarkdownDiv";

const MARKDOWN = [
  "# Heading",
  "[link](https://example.com/phish)",
  "![img](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)",
  "$x^2$ and bidi \u202Egnp.exe\u202C",
].join("\n");

// No math: the trusted-path test shouldn't wait on MathJax's lazy chunk load.
const RICH_MARKDOWN = MARKDOWN.split("\n").slice(0, 3).join("\n");

const TrustValue = () => (
  <span>{useHasAllContentPermissions() ? "trusted" : "untrusted"}</span>
);
const Permissions = () => {
  const policy = useContentPolicy();
  return <span>{JSON.stringify(policy)}</span>;
};

describe("content trust", () => {
  it("intersects source permissions with the application ceiling", () => {
    const { container } = render(
      <ContentPolicyCeilingProvider
        value={{ ...richContentPolicy, syntaxHighlighting: false }}
      >
        <ContentPolicyProvider value={{ ...richContentPolicy, links: false }}>
          <Permissions />
        </ContentPolicyProvider>
      </ContentPolicyCeilingProvider>
    );
    expect(JSON.parse(container.textContent)).toEqual({
      ...richContentPolicy,
      syntaxHighlighting: false,
      links: false,
    });
  });

  it("defaults to untrusted outside any provider", () => {
    render(<TrustValue />);
    expect(screen.getByText("untrusted")).toBeTruthy();
  });

  it("renders untrusted markdown as its source text", async () => {
    const { container } = render(
      <ContentTrustProvider value="untrusted">
        <MarkdownDiv markdown={MARKDOWN} />
      </ContentTrustProvider>
    );
    const root = container.firstElementChild;
    expect(root?.classList.contains("untrusted-content")).toBe(true);
    expect(root?.textContent).toContain("# Heading");
    expect(root?.textContent).toContain("[link](https://example.com/phish)");
    expect(root?.textContent).toContain("⟨U+202E⟩gnp.exe⟨U+202C⟩");
    expect(root?.classList.contains(untrustedTextClassName)).toBe(true);
    // Give any (wrongly) scheduled async render a chance to land.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector("a, img, h1, mjx-container")).toBeNull();
  });

  it("renders trusted markdown richly", async () => {
    const { container } = render(
      <ContentTrustProvider value="trusted">
        <MarkdownDiv markdown={RICH_MARKDOWN} />
      </ContentTrustProvider>
    );
    await waitFor(() => {
      expect(container.querySelector("a[href]")).not.toBeNull();
    });
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("shows untrusted ANSI output with escapes revealed and no styling", () => {
    const { container } = render(
      <ContentTrustProvider value="untrusted">
        <ANSIDisplay output={"\u001b[32mPASS\u001b[0m"} />
      </ContentTrustProvider>
    );
    expect(container.textContent).toBe("⟨U+001B⟩[32mPASS⟨U+001B⟩[0m");
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("withholds gated children for untrusted content", () => {
    render(
      <ContentTrustProvider value="untrusted">
        <RequireMedia kind="image">
          <img alt="payload" src="data:image/png;base64,AAAA" />
        </RequireMedia>
      </ContentTrustProvider>
    );
    expect(screen.queryByAltText("payload")).toBeNull();
    expect(
      screen.getByText(/image not shown: log content is untrusted/)
    ).toBeTruthy();
  });

  it("renders gated children for trusted content", () => {
    render(
      <ContentTrustProvider value="trusted">
        <RequireMedia kind="image">
          <img alt="payload" src="data:image/png;base64,AAAA" />
        </RequireMedia>
      </ContentTrustProvider>
    );
    expect(screen.getByAltText("payload")).toBeTruthy();
  });

  it("does not load the terminal player for untrusted content", () => {
    render(
      <ContentTrustProvider value="untrusted">
        <AsciinemaPlayer
          inputUrl="blob:x"
          outputUrl="blob:y"
          timingUrl="blob:z"
        />
      </ContentTrustProvider>
    );
    expect(
      screen.getByText(/terminal session not shown: log content is untrusted/)
    ).toBeTruthy();
  });

  it("reveals hidden characters in untrusted plain text", () => {
    const { container } = render(
      <ContentTrustProvider value="untrusted">
        <ContentText text={"a\u202Eb"} />
      </ContentTrustProvider>
    );
    expect(container.textContent).toBe("a⟨U+202E⟩b");
    // An inline bidi isolate; wrapping is left to the surrounding container.
    const span = container.querySelector("span");
    expect(span?.textContent).toBe("a⟨U+202E⟩b");
    expect(span?.className).not.toBe("");
    expect(span?.className).not.toContain(untrustedTextClassName);
  });

  it("leaves trusted plain text as-is", () => {
    const { container } = render(
      <ContentTrustProvider value="trusted">
        <ContentText text={"a\u202Eb"} />
      </ContentTrustProvider>
    );
    expect(container.textContent).toBe("a\u202Eb");
  });

  it("reveals hidden characters in untrusted JSON", () => {
    const { container } = render(
      <ContentTrustProvider value="untrusted">
        <JSONPanel data={{ name: "\u202Egnp.exe" }} />
      </ContentTrustProvider>
    );
    expect(container.textContent).toContain("⟨U+202E⟩gnp.exe");
    expect(container.querySelector(".token")).toBeNull();
  });

  it("caps nested trust with a ceiling", () => {
    render(
      <ContentTrustCeilingProvider value="untrusted">
        <ContentTrustProvider value="trusted">
          <TrustValue />
        </ContentTrustProvider>
      </ContentTrustCeilingProvider>
    );
    expect(screen.getByText("untrusted")).toBeTruthy();
  });

  it("doesn't let a nested ceiling raise an outer one", () => {
    render(
      <ContentTrustCeilingProvider value="untrusted">
        <ContentTrustCeilingProvider value="trusted">
          <ContentTrustProvider value="trusted">
            <TrustValue />
          </ContentTrustProvider>
        </ContentTrustCeilingProvider>
      </ContentTrustCeilingProvider>
    );
    expect(screen.getByText("untrusted")).toBeTruthy();
  });

  it("leaves trust alone under a trusted ceiling", () => {
    render(
      <ContentTrustCeilingProvider value="trusted">
        <ContentTrustProvider value="trusted">
          <TrustValue />
        </ContentTrustProvider>
      </ContentTrustCeilingProvider>
    );
    expect(screen.getByText("trusted")).toBeTruthy();
  });
});

it("withholds terminal playback when ANSI is denied even if media is allowed", () => {
  const { container } = render(
    <ContentPolicyProvider value={{ ...richContentPolicy, ansi: false }}>
      <AsciinemaPlayer inputUrl="input" outputUrl="output" timingUrl="timing" />
    </ContentPolicyProvider>
  );
  expect(
    container.querySelector('[data-untrusted-placeholder="terminal session"]')
  ).not.toBeNull();
});
