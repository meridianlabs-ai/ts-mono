// @vitest-environment jsdom
import { render as renderUi, screen, waitFor } from "@testing-library/react";
import { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { TrustedContentWrapper } from "../test/content-trust";

import { richContentPolicy } from "./contentRenderingPolicy";
import { ContentPolicyProvider } from "./ContentTrust";
import { MarkdownDiv, MarkdownRenderQueue } from "./MarkdownDiv";

// These tests exercise the rich rendering path, which needs trusted content.
const render = (ui: ReactElement) =>
  renderUi(ui, { wrapper: TrustedContentWrapper });

describe("MarkdownDiv render coordination", () => {
  it("isolates cached HTML and pending output when rendering permissions change", async () => {
    const markdown =
      "# Policy cache\n$x^2$\n[label](https://example.com/policy)";
    const view = (restricted: boolean) => (
      <ContentPolicyProvider
        value={{ ...richContentPolicy, math: !restricted, links: !restricted }}
      >
        <MarkdownDiv markdown={markdown} />
      </ContentPolicyProvider>
    );
    const { container, rerender } = render(view(false));
    await waitFor(() =>
      expect(container.querySelector("mjx-container")).not.toBeNull()
    );
    expect(container.querySelector("a[href]")).not.toBeNull();
    rerender(view(true));
    expect(container.querySelector("mjx-container, a[href]")).toBeNull();
    await waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
    expect(container.textContent).toContain("$x^2$");
    expect(container.textContent).toContain("https://example.com/policy");
    expect(container.querySelector("mjx-container, a[href]")).toBeNull();
    rerender(view(false));
    await waitFor(() =>
      expect(container.querySelector("mjx-container")).not.toBeNull()
    );
    expect(container.querySelector("a[href]")).not.toBeNull();
  });

  it("enforces link and media permissions after HTML post-processing", async () => {
    const { container } = render(
      <ContentPolicyProvider
        value={{ ...richContentPolicy, links: false, media: false }}
      >
        <MarkdownDiv
          markdown="# Post-process policy"
          postProcess={(html) =>
            `${html}<a href="https://example.com/injected">injected link</a><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">`
          }
        />
      </ContentPolicyProvider>
    );
    await waitFor(() =>
      expect(container.textContent).toContain("injected link")
    );
    expect(
      container.querySelector("a, img, [href], [xlink\\:href]")
    ).toBeNull();
  });

  it("allows math while denying links emitted by MathJax", async () => {
    const { container } = render(
      <ContentPolicyProvider value={{ ...richContentPolicy, links: false }}>
        <MarkdownDiv markdown={"$\\href{https://example.com/math-link}{x}$"} />
      </ContentPolicyProvider>
    );
    await waitFor(() =>
      expect(container.querySelector("mjx-container")).not.toBeNull()
    );
    expect(
      container.querySelector(
        'a, [href]:not([href^="#"]), [xlink\\:href]:not([xlink\\:href^="#"])'
      )
    ).toBeNull();
  });

  it("preserves rendered math glyphs when content links are disabled", async () => {
    const { container } = render(
      <ContentPolicyProvider value={{ ...richContentPolicy, links: false }}>
        <MarkdownDiv markdown={"$\\frac{x^2}{y}$"} />
      </ContentPolicyProvider>
    );
    await waitFor(() =>
      expect(container.querySelector("mjx-container svg path")).not.toBeNull()
    );
    expect(container.querySelector("a")).toBeNull();
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
