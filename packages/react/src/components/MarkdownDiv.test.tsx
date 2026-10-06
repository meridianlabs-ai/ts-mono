// @vitest-environment jsdom
import { render as renderUi, screen, waitFor } from "@testing-library/react";
import { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { TrustedContentWrapper } from "../test/content-trust";

import { richContentPolicy } from "./contentRenderingPolicy";
import { ContentPolicyProvider } from "./ContentTrustContext";
import { MarkdownDiv, MarkdownRenderQueue } from "./MarkdownDiv";

// These tests exercise the rich rendering path, which needs trusted content.
const render = (ui: ReactElement) =>
  renderUi(ui, { wrapper: TrustedContentWrapper });

describe("MarkdownDiv render coordination", () => {
  it("renders markdown as source text unless every permission is granted", () => {
    const { container } = renderUi(
      <ContentPolicyProvider value={{ ...richContentPolicy, links: false }}>
        <MarkdownDiv markdown="**bold** [link](https://example.com)" />
      </ContentPolicyProvider>
    );
    expect(container.textContent).toBe("**bold** [link](https://example.com)");
    expect(container.querySelector(".markdown-content, strong, a")).toBeNull();
  });

  it("keeps callbacks independent for duplicate markdown with different post-processing", async () => {
    render(
      <>
        <MarkdownDiv
          markdown="same **markdown**"
          postProcess={(html) =>
            `<section data-testid="first">${html}</section>`
          }
        />
        <MarkdownDiv
          markdown="same **markdown**"
          postProcess={(html) => `<aside data-testid="second">${html}</aside>`}
        />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId("first").innerHTML).toContain(
        "<strong>markdown</strong>"
      );
      expect(screen.getByTestId("second").innerHTML).toContain(
        "<strong>markdown</strong>"
      );
    });
  });
});

describe("MarkdownRenderQueue", () => {
  it("cancel only affects its own queued task", async () => {
    const queue = new MarkdownRenderQueue(1);

    let releaseA!: () => void;
    const a = queue.enqueue(
      () =>
        new Promise<string>((resolve) => {
          releaseA = () => resolve("a");
        })
    );
    // b and c are backlogged behind a (maxConcurrent=1)
    const b = queue.enqueue(() => Promise.resolve("b"));
    const c = queue.enqueue(() => Promise.resolve("c"));

    c.cancel();
    releaseA();

    await expect(a.promise).resolves.toBe("a");
    const starved = Symbol("starved");
    const bResult = await Promise.race([
      b.promise,
      new Promise((resolve) => setTimeout(() => resolve(starved), 250)),
    ]);
    expect(bResult).toBe("b");
  });
});
