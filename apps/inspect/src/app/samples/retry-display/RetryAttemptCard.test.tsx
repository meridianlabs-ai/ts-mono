// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComponentProps, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvalRetryError } from "@tsmono/inspect-common";
import { testErrorEvent } from "@tsmono/inspect-common/testing";
import { ResizeObserverStub } from "@tsmono/react/testing";

import {
  ComponentProviders,
  startTestApp,
  stopTestApp,
} from "../../../test/testApp";

import { RetryAttemptCard } from "./RetryAttemptCard";

// TranscriptLayout is a virtualized list, which renders no rows without
// layout in jsdom; stub it with a marker so this test can see which view the
// card shows.
vi.mock("@tsmono/inspect-components/transcript", () => ({
  TranscriptLayout: () => <div data-testid="transcript-layout" />,
}));

const baseRetry: EvalRetryError = {
  message: "Simulated failure for sample rec0Arme2jcXQZnAW",
  traceback: "Traceback ...\nRuntimeError: Simulated failure",
  traceback_ansi: "RuntimeError: Simulated failure",
  events: null,
};

const withEvents = (): EvalRetryError => ({
  ...baseRetry,
  events: [testErrorEvent()],
});

function renderCard(
  props: Partial<ComponentProps<typeof RetryAttemptCard>> = {}
) {
  const scrollRef = createRef<HTMLDivElement>();
  return render(
    <ComponentProviders>
      <RetryAttemptCard
        retry={baseRetry}
        attemptNumber={1}
        isOpen={true}
        onToggleOpen={() => {}}
        listId="test-list-0"
        scrollRef={scrollRef}
        {...props}
      />
    </ComponentProviders>
  );
}

describe("RetryAttemptCard", () => {
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

  it("renders the attempt number and derived error-type chip", () => {
    renderCard();
    expect(screen.getByText("Attempt 1")).toBeDefined();
    expect(screen.getByText("RuntimeError")).toBeDefined();
  });

  it("shows the traceback (and no toggle) when expanded with no events", () => {
    renderCard();
    expect(screen.getByText("RuntimeError: Simulated failure")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Events" })).toBeNull();
  });

  it("shows the Error/Events toggle only when events exist", () => {
    renderCard({ retry: withEvents() });
    expect(screen.getByRole("button", { name: "Error" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Events" })).toBeDefined();
  });

  it("defaults to the error view and switches to events on toggle", () => {
    renderCard({ retry: withEvents() });
    expect(screen.getByText("RuntimeError: Simulated failure")).toBeDefined();
    expect(screen.queryByTestId("transcript-layout")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getByTestId("transcript-layout")).toBeDefined();
    expect(screen.queryByText("RuntimeError: Simulated failure")).toBeNull();
  });

  it("toggling the view does not collapse the card", () => {
    const onToggleOpen = vi.fn();
    renderCard({ retry: withEvents(), onToggleOpen });
    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it("calls onToggleOpen when the header is clicked", () => {
    const onToggleOpen = vi.fn();
    renderCard({ onToggleOpen });
    fireEvent.click(screen.getByText("Attempt 1"));
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
  });

  it("hides the body and toggle when collapsed", () => {
    renderCard({ isOpen: false, retry: withEvents() });
    expect(screen.queryByRole("button", { name: "Events" })).toBeNull();
    expect(screen.queryByText("RuntimeError: Simulated failure")).toBeNull();
    expect(screen.queryByTestId("transcript-layout")).toBeNull();
  });

  it("toggles open on Enter and Space keydown on the header", () => {
    const onToggleOpen = vi.fn();
    renderCard({ onToggleOpen, isOpen: false });
    const header = screen.getByText("Attempt 1").closest("[role='button']");
    expect(header).not.toBeNull();
    fireEvent.keyDown(header!, { key: "Enter" });
    fireEvent.keyDown(header!, { key: " " });
    expect(onToggleOpen).toHaveBeenCalledTimes(2);
  });
});
