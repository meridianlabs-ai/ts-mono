// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComponentNavigationProvider,
  ContentTrustProvider,
  untrustedTextClassName,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  makeReactiveStateStore,
  ResizeObserverStub,
  TrustedContentWrapper,
} from "@tsmono/react/testing";

import { ToolOutput } from "../chat/tools/ToolOutput";

import { DisplayModeContext } from "./DisplayModeContext";
import { RenderedText } from "./RenderedText";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const withProviders = (
  ui: ReactNode,
  hooks: ReturnType<typeof makeReactiveStateStore>["hooks"]
) => (
  <TrustedContentWrapper>
    <ComponentStateProvider hooks={hooks}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <DisplayModeContext.Provider value={{ displayMode: "rendered" }}>
          {ui}
        </DisplayModeContext.Provider>
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  </TrustedContentWrapper>
);

// 300K characters: a bold opening line, filler, and a marker past 250K.
const markdown = `**Opening** line\n\n${"filler text\n".repeat(25_000)}TAIL-MARKER`;

describe("text past 250K characters", () => {
  // Rendering 250K of markdown takes seconds on a loaded machine.
  it(
    "renders the first 250K, and all of it as plain text on request",
    { timeout: 30_000 },
    async () => {
      const { container } = render(
        withProviders(
          <RenderedText markdown={markdown} className="caller-class" />,
          makeReactiveStateStore().hooks
        )
      );
      await waitFor(
        () => {
          expect(container.querySelector("strong")?.textContent).toBe(
            "Opening"
          );
        },
        { timeout: 15_000 }
      );
      expect(container.textContent).not.toContain("TAIL-MARKER");
      expect(container.textContent).toContain(
        "Output truncated — 50K characters hidden."
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Show all", expanded: false })
      );
      expect(container.textContent).toContain("TAIL-MARKER");
      expect(container.textContent).toContain("**Opening** line");
      expect(container.querySelector("strong")).toBeNull();
      // Shown the way the caller shows plain text.
      expect(
        container.querySelector("pre.caller-class")?.textContent
      ).toContain("TAIL-MARKER");

      expect(container.textContent).toContain("Showing all as plain text.");

      fireEvent.click(
        screen.getByRole("button", { name: "Truncate", expanded: true })
      );
      expect(container.textContent).not.toContain("TAIL-MARKER");
    }
  );

  it("keeps showing all of it when the text mounts again", () => {
    const hooks = makeReactiveStateStore().hooks;
    const first = render(
      withProviders(<RenderedText markdown={markdown} />, hooks)
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    first.unmount();

    const { container } = render(
      withProviders(<RenderedText markdown={markdown} />, hooks)
    );
    expect(container.textContent).toContain("TAIL-MARKER");
  });

  it("colors the first 250K of ANSI tool output, and shows all of it without escapes on request", async () => {
    // Long lines keep the colored head to a few hundred line elements.
    const output = `${`\u001b[31mred\u001b[0m ${"x".repeat(1_000)}\n`.repeat(300)}TAIL-MARKER`;
    const { container } = render(
      withProviders(
        <ToolOutput output={output} />,
        makeReactiveStateStore().hooks
      )
    );
    await waitFor(() => {
      expect(container.querySelector("span[style*='color']")).not.toBeNull();
    });
    expect(container.textContent).not.toContain("TAIL-MARKER");

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(container.textContent).toContain("TAIL-MARKER");
    expect(container.textContent).not.toContain("\u001b");
    expect(container.querySelector("pre.tool-output")?.textContent).toContain(
      "TAIL-MARKER"
    );
  });

  it("counts a few hidden characters exactly", () => {
    const { container } = render(
      withProviders(
        <ToolOutput output={"x".repeat(250_400)} />,
        makeReactiveStateStore().hooks
      )
    );
    expect(container.textContent).toContain(
      "Output truncated — 400 characters hidden."
    );
  });

  it("counts a single hidden character in the singular", () => {
    const { container } = render(
      withProviders(
        <ToolOutput output={"x".repeat(250_001)} />,
        makeReactiveStateStore().hooks
      )
    );
    expect(container.textContent).toContain(
      "Output truncated — 1 character hidden."
    );
  });

  it("strips ANSI escapes that start past the first 250K from the full text", () => {
    const output = `${"plain line\n".repeat(25_000)}\u001b[31mFAILED\u001b[0m`;
    const { container } = render(
      withProviders(
        <ToolOutput output={output} />,
        makeReactiveStateStore().hooks
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(container.textContent).toContain("FAILED");
    expect(container.textContent).not.toContain("\u001b");
  });

  it.each([
    ["tool output", (text: string) => <ToolOutput output={text} />],
    ["text", (text: string) => <RenderedText markdown={text} />],
  ])(
    "shows all of an untrusted %s with its hidden characters revealed",
    (_, ui) => {
      const { container } = render(
        <ContentTrustProvider value="untrusted">
          <ComponentStateProvider hooks={makeReactiveStateStore().hooks}>
            <DisplayModeContext.Provider value={{ displayMode: "rendered" }}>
              {ui(`${"x".repeat(250_000)}tail \u202Eflipped`)}
            </DisplayModeContext.Provider>
          </ComponentStateProvider>
        </ContentTrustProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "Show all" }));
      const full = container.querySelector(`pre.${untrustedTextClassName}`);
      expect(full?.textContent).toContain("tail ⟨U+202E⟩flipped");
      expect(container.textContent).not.toContain("\u202E");
    }
  );

  it("goes back to the first 250K when all of it would be taller than a browser lays out", () => {
    // jsdom lays nothing out: give every line a 20px row.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 0, 20)
    );
    const { container } = render(
      withProviders(
        <ToolOutput output={`${"1\n".repeat(800_000)}TAIL-MARKER`} />,
        makeReactiveStateStore().hooks
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(container.textContent).not.toContain("TAIL-MARKER");
    expect(container.textContent).toContain("Too long to show in full.");
    // Asking again measures again.
    expect(screen.getByRole("button", { name: "Show all" })).not.toBeNull();
  });

  it("keeps the control sequences of untrusted ANSI output visible in the full text", () => {
    const { container } = render(
      <ContentTrustProvider value="untrusted">
        <ComponentStateProvider hooks={makeReactiveStateStore().hooks}>
          <DisplayModeContext.Provider value={{ displayMode: "rendered" }}>
            <ToolOutput
              output={`${"x".repeat(250_000)}\u001b]0;HIDDEN-PAYLOAD\u0007VISIBLE`}
            />
          </DisplayModeContext.Provider>
        </ComponentStateProvider>
      </ContentTrustProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(container.textContent).toContain(
      "⟨U+001B⟩]0;HIDDEN-PAYLOAD⟨U+0007⟩VISIBLE"
    );
  });

  it("strips OSC sequences from trusted ANSI output's full text", () => {
    const output = `${"plain line\n".repeat(25_000)}\u001b]0;TITLE\u0007VISIBLE`;
    const { container } = render(
      withProviders(
        <ToolOutput output={output} />,
        makeReactiveStateStore().hooks
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(container.textContent).toContain("VISIBLE");
    expect(container.textContent).not.toContain("TITLE");
  });

  it("goes back to the first 250K when all of it would end past what a browser lays out", () => {
    // jsdom lays nothing out: a short text, 20px a row, that would start
    // 14,990,000px down its scroll content.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 14_990_000, 0, 20)
    );
    const { container } = render(
      withProviders(
        <ToolOutput output={`${"x".repeat(250_000)}\n${"1\n".repeat(600)}`} />,
        makeReactiveStateStore().hooks
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(container.textContent).toContain("Too long to show in full.");
  });

  it("tells every copy of a text that it's too long, and still offers all of it", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 0, 20));
    const output = `${"1\n".repeat(800_000)}TAIL-MARKER`;
    const { container } = render(
      withProviders(
        <>
          <ToolOutput output={output} />
          <ToolOutput output={output} />
        </>,
        makeReactiveStateStore().hooks
      )
    );
    const [first] = screen.getAllByRole("button", { name: "Show all" });
    if (!first) {
      throw new Error("expected a Show all button");
    }
    fireEvent.click(first);
    expect(
      container.textContent.split("Too long to show in full.").length - 1
    ).toBe(2);

    // Rows half as tall now (a wider view, say): asking again shows it.
    rect.mockReturnValue(new DOMRect(0, 0, 0, 10));
    fireEvent.click(first);
    expect(container.textContent).toContain("TAIL-MARKER");
    expect(container.textContent).not.toContain("Too long to show in full.");
  });
});
