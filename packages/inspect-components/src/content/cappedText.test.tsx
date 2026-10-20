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

import { ComponentNavigationProvider } from "@tsmono/react/components";
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
  it("renders the first 250K, and all of it as plain text on request", async () => {
    const { container } = render(
      withProviders(
        <RenderedText markdown={markdown} className="caller-class" />,
        makeReactiveStateStore().hooks
      )
    );
    // Rendering 250K of markdown takes seconds on a loaded machine.
    await waitFor(
      () => {
        expect(container.querySelector("strong")?.textContent).toBe("Opening");
      },
      { timeout: 15_000 }
    );
    expect(container.textContent).not.toContain("TAIL-MARKER");
    expect(container.textContent).toContain(
      "Showing the first 250,000 of 300,029 characters."
    );

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(container.textContent).toContain("TAIL-MARKER");
    expect(container.textContent).toContain("**Opening** line");
    expect(container.querySelector("strong")).toBeNull();
    // Shown the way the caller shows plain text.
    expect(container.querySelector("pre.caller-class")?.textContent).toContain(
      "TAIL-MARKER"
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show the first 250,000" })
    );
    expect(container.textContent).not.toContain("TAIL-MARKER");
  });

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
});
