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
    const output = `${"\u001b[31mred\u001b[0m line\n".repeat(30_000)}TAIL-MARKER`;
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
});
