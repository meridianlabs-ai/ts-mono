// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EvalRetryError } from "@tsmono/inspect-common";

vi.mock("@tsmono/inspect-components/transcript", () => ({
  TranscriptLayout: () => <div data-testid="transcript-layout" />,
}));

// ANSIDisplay needs an icon-provider context that isn't present in jsdom; stub
// it (rendering its output text) so we can assert which attempt's traceback is open.
vi.mock("@tsmono/react/components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tsmono/react/components")>();
  return {
    ...actual,
    ANSIDisplay: ({ output }: { output: string }) => (
      <pre data-testid="ansi-display">{output}</pre>
    ),
  };
});

import { SampleRetriedErrors } from "./SampleRetriedErrors";

function makeRetry(n: number): EvalRetryError {
  return {
    message: `failure ${n}`,
    traceback: `Traceback ...\nRuntimeError: failure ${n}`,
    traceback_ansi: `RuntimeError: failure ${n}`,
    events: null,
  };
}

function renderPanel(count: number) {
  const scrollRef = createRef<HTMLDivElement>();
  const retries = Array.from({ length: count }, (_, i) => makeRetry(i + 1));
  return render(
    <SampleRetriedErrors id="s1" retries={retries} scrollRef={scrollRef} />,
  );
}

describe("SampleRetriedErrors", () => {
  afterEach(() => cleanup());

  it("renders one card per attempt plus the terminal anchor", () => {
    renderPanel(3);
    expect(screen.getByText("Attempt 1")).toBeDefined();
    expect(screen.getByText("Attempt 2")).toBeDefined();
    expect(screen.getByText("Attempt 3")).toBeDefined();
    expect(screen.getByText(/after 3 retries/)).toBeDefined();
  });

  it("opens the most recent attempt by default", () => {
    renderPanel(3);
    expect(screen.getByText("RuntimeError: failure 3")).toBeDefined();
  });

  it("is an accordion — opening one closes the previously open card", () => {
    renderPanel(3);
    expect(screen.getByText("RuntimeError: failure 3")).toBeDefined();
    fireEvent.click(screen.getByText("Attempt 1"));
    expect(screen.getByText("RuntimeError: failure 1")).toBeDefined();
    expect(screen.queryByText("RuntimeError: failure 3")).toBeNull();
  });

  it("clicking the open card header collapses it", () => {
    renderPanel(2);
    expect(screen.getByText("RuntimeError: failure 2")).toBeDefined();
    fireEvent.click(screen.getByText("Attempt 2"));
    expect(screen.queryByText("RuntimeError: failure 2")).toBeNull();
  });

  it("remembers an attempt's Error/Events selection across collapse and reopen", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const withEvents = (n: number): EvalRetryError => ({
      ...makeRetry(n),
      events: [{ event: "error" }] as unknown as EvalRetryError["events"],
    });
    render(
      <SampleRetriedErrors id="s1" retries={[withEvents(1), withEvents(2)]} scrollRef={scrollRef} />,
    );
    // Attempt 2 is open by default on the Error view (traceback, no transcript).
    expect(screen.queryByTestId("transcript-layout")).toBeNull();
    // Switch it to Events.
    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getByTestId("transcript-layout")).toBeDefined();
    // Collapse then reopen attempt 2 — the Events selection should persist.
    fireEvent.click(screen.getByText("Attempt 2"));
    fireEvent.click(screen.getByText("Attempt 2"));
    expect(screen.getByTestId("transcript-layout")).toBeDefined();
  });
});
