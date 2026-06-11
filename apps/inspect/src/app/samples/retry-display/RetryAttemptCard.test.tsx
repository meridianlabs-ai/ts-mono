// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComponentProps, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EvalRetryError } from "@tsmono/inspect-common";

// TranscriptLayout pulls in the full transcript stack; stub it so this test
// exercises only the card's own structure.
vi.mock("@tsmono/inspect-components/transcript", () => ({
  TranscriptLayout: () => <div data-testid="transcript-layout" />,
}));

vi.mock("@tsmono/react/components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tsmono/react/components")>();
  return {
    ...actual,
    // ANSIDisplay needs an icon-provider context, and ExpandablePanel needs the
    // component-state provider — neither is present in jsdom. Stub both so the
    // card's own logic is what's under test.
    ANSIDisplay: ({ output }: { output: string }) => (
      <pre data-testid="ansi-display">{output}</pre>
    ),
    ExpandablePanel: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="expandable-panel">{children}</div>
    ),
  };
});

import { RetryAttemptCard } from "./RetryAttemptCard";

const baseRetry: EvalRetryError = {
  message: "Simulated failure for sample rec0Arme2jcXQZnAW",
  traceback: "Traceback ...\nRuntimeError: Simulated failure",
  traceback_ansi: "RuntimeError: Simulated failure",
  events: null,
};

const withEvents = (): EvalRetryError => ({
  ...baseRetry,
  events: [{ event: "error" }] as unknown as EvalRetryError["events"],
});

function renderCard(props: Partial<ComponentProps<typeof RetryAttemptCard>> = {}) {
  const scrollRef = createRef<HTMLDivElement>();
  return render(
    <RetryAttemptCard
      retry={baseRetry}
      attemptNumber={1}
      isOpen={true}
      onToggleOpen={() => {}}
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

  it("always shows the Error section with the traceback", () => {
    renderCard();
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByTestId("ansi-display")).toBeDefined();
  });

  it("shows no Events section when there are no events", () => {
    renderCard();
    expect(screen.queryByText("Terminal Events")).toBeNull();
    expect(screen.queryByTestId("transcript-layout")).toBeNull();
  });

  it("shows both Error and Events sections when events exist", () => {
    renderCard({ retry: withEvents() });
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Terminal Events")).toBeDefined();
    expect(screen.getByTestId("ansi-display")).toBeDefined();
    expect(screen.getByTestId("transcript-layout")).toBeDefined();
  });

  it("calls onToggleOpen when the header is clicked", () => {
    const onToggleOpen = vi.fn();
    renderCard({ onToggleOpen });
    fireEvent.click(screen.getByText("Attempt 1"));
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
  });

  it("hides the body when collapsed", () => {
    renderCard({ isOpen: false, retry: withEvents() });
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.queryByTestId("ansi-display")).toBeNull();
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
