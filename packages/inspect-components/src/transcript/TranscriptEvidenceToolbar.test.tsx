// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranscriptEvidenceToolbar } from "./TranscriptEvidenceToolbar";
import type { EventType } from "./types";

afterEach(cleanup);

const evidenceEvent = {
  event: "info",
  uuid: "evidence-1",
  timestamp: "2026-07-25T00:00:00Z",
  source: "auditor",
  data: "The model favored the principal despite contrary evidence.",
} as EventType;

describe("TranscriptEvidenceToolbar", () => {
  it("starts selection mode from the inactive state", () => {
    const onActivate = vi.fn();
    render(
      <TranscriptEvidenceToolbar
        active={false}
        events={[]}
        onActivate={onActivate}
        onCancel={() => {}}
        onClear={() => {}}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Select transcript evidence" })
    );
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("copies selected events as Markdown", async () => {
    let copiedValue = "";
    const writeText = vi.fn((value: string): Promise<void> => {
      copiedValue = value;
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <TranscriptEvidenceToolbar
        active={true}
        events={[evidenceEvent]}
        onActivate={() => {}}
        onCancel={() => {}}
        onClear={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(copiedValue).toContain("## Info");
    expect(copiedValue).toContain("**Source:** auditor");
  });
});
