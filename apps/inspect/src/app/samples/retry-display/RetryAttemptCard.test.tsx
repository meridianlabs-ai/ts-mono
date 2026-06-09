// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EvalRetryError } from "@tsmono/inspect-common";

// TranscriptLayout pulls in the full transcript stack; stub it so this test
// exercises only the card's own header/toggle/traceback logic.
vi.mock("@tsmono/inspect-components/transcript", () => ({
  TranscriptLayout: () => <div data-testid="transcript-layout" />,
}));

import { RetryAttemptCard } from "./RetryAttemptCard";

const baseRetry: EvalRetryError = {
  message: "Simulated failure for sample rec0Arme2jcXQZnAW",
  traceback: "Traceback ...\nRuntimeError: Simulated failure",
  traceback_ansi: "RuntimeError: Simulated failure",
  events: null,
};

function renderCard(props: Partial<React.ComponentProps<typeof RetryAttemptCard>> = {}) {
  const scrollRef = createRef<HTMLDivElement>();
  return render(
    <RetryAttemptCard
      retry={baseRetry}
      index={0}
      attemptNumber={1}
      isOpen={true}
      view="error"
      onToggleOpen={() => {}}
      onViewChange={() => {}}
      listId="test-list-0"
      scrollRef={scrollRef}
      {...props}
    />,
  );
}

describe("RetryAttemptCard", () => {
  afterEach(() => cleanup());

  it("renders the attempt number and derived error-type chip", () => {
    renderCard();
    expect(screen.getByText("Attempt 1")).toBeDefined();
    expect(screen.getByText("RuntimeError")).toBeDefined();
  });

  it("shows the traceback in the error view and no Events toggle when there are no events", () => {
    renderCard({ view: "error" });
    expect(screen.queryByRole("button", { name: /events/i })).toBeNull();
    expect(screen.queryByTestId("transcript-layout")).toBeNull();
  });

  it("renders the Error/Events toggle when events exist", () => {
    renderCard({ retry: { ...baseRetry, events: [{ event: "error" }] as unknown as EvalRetryError["events"] } });
    expect(screen.getByRole("button", { name: /error/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /events/i })).toBeDefined();
  });

  it("renders the transcript when view is events", () => {
    renderCard({
      retry: { ...baseRetry, events: [{ event: "error" }] as unknown as EvalRetryError["events"] },
      view: "events",
    });
    expect(screen.getByTestId("transcript-layout")).toBeDefined();
  });

  it("calls onToggleOpen when the header is clicked", () => {
    const onToggleOpen = vi.fn();
    renderCard({ onToggleOpen });
    fireEvent.click(screen.getByText("Attempt 1"));
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
  });

  it("hides the body when collapsed", () => {
    renderCard({ isOpen: false, retry: { ...baseRetry, events: [{ event: "error" }] as unknown as EvalRetryError["events"] } });
    expect(screen.queryByRole("button", { name: /events/i })).toBeNull();
  });
});
