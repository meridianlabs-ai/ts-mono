// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvalRetryError } from "@tsmono/inspect-common";
import { testErrorEvent } from "@tsmono/inspect-common/testing";
import { ResizeObserverStub } from "@tsmono/react/testing";

import {
  ComponentProviders,
  startTestApp,
  stopTestApp,
} from "../../test/testApp";

import { SampleRetriedErrors } from "./SampleRetriedErrors";

// TranscriptLayout is a virtualized list, which renders no rows without
// layout in jsdom; stub it with a marker so this test can see which view is
// open.
vi.mock("@tsmono/inspect-components/transcript", () => ({
  TranscriptLayout: () => <div data-testid="transcript-layout" />,
}));

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
    <ComponentProviders>
      <SampleRetriedErrors id="s1" retries={retries} scrollRef={scrollRef} />
    </ComponentProviders>
  );
}

describe("SampleRetriedErrors", () => {
  beforeEach(() => {
    // jsdom has no ResizeObserver; the expandable traceback panel measures.
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    startTestApp();
  });
  afterEach(async () => {
    cleanup();
    await stopTestApp();
    vi.unstubAllGlobals();
  });

  it("renders one card per attempt plus the terminal anchor", () => {
    renderPanel(3);
    expect(screen.getByText("Attempt 1")).toBeDefined();
    expect(screen.getByText("Attempt 2")).toBeDefined();
    expect(screen.getByText("Attempt 3")).toBeDefined();
    expect(screen.getByText(/after 3 retries/)).toBeDefined();
    expect(screen.getByText("This run succeeded")).toBeDefined();
  });

  it("shows failure copy in the anchor when the sample ended in error", () => {
    const scrollRef = createRef<HTMLDivElement>();
    render(
      <ComponentProviders>
        <SampleRetriedErrors
          id="s1"
          retries={[makeRetry(1), makeRetry(2)]}
          error={{
            message: "RuntimeError('boom')",
            traceback: "boom",
            traceback_ansi: "boom",
          }}
          scrollRef={scrollRef}
        />
      </ComponentProviders>
    );
    expect(screen.getByText("This run failed")).toBeDefined();
    expect(screen.queryByText("This run succeeded")).toBeNull();
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

  it("shows the open attempt's events after toggling to the Events view", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const withEvents = (n: number): EvalRetryError => ({
      ...makeRetry(n),
      events: [testErrorEvent()],
    });
    render(
      <ComponentProviders>
        <SampleRetriedErrors
          id="s1"
          retries={[withEvents(1), withEvents(2)]}
          scrollRef={scrollRef}
        />
      </ComponentProviders>
    );
    // Attempt 2 is open by default on the Error view (only the expanded card
    // exposes the toggle).
    expect(screen.getByText("RuntimeError: failure 2")).toBeDefined();
    expect(screen.queryByTestId("transcript-layout")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getByTestId("transcript-layout")).toBeDefined();
  });
});
