// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ANSIDisplay } from "./AnsiDisplay";
import { AsciinemaPlayer } from "./AsciinemaPlayer";
import {
  ContentTrustProvider,
  RequireTrustedContent,
  useContentTrust,
} from "./ContentTrust";
import { MarkdownDiv } from "./MarkdownDiv";

const MARKDOWN = [
  "# Heading",
  "[link](https://example.com/phish)",
  "![img](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)",
  "$x^2$ and bidi ‮gnp.exe‬",
].join("\n");

const TrustValue = () => <span>{useContentTrust()}</span>;

describe("content trust", () => {
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
    // Give any (wrongly) scheduled async render a chance to land.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector("a, img, h1, mjx-container")).toBeNull();
  });

  it("renders trusted markdown richly", async () => {
    const { container } = render(
      <ContentTrustProvider value="trusted">
        <MarkdownDiv markdown={MARKDOWN} />
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
        <RequireTrustedContent kind="image">
          <img alt="payload" src="data:image/png;base64,AAAA" />
        </RequireTrustedContent>
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
        <RequireTrustedContent kind="image">
          <img alt="payload" src="data:image/png;base64,AAAA" />
        </RequireTrustedContent>
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
});
