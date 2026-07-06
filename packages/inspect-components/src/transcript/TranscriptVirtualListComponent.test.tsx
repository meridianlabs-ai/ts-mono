// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderTranscriptFooter } from "./TranscriptVirtualListComponent";

describe("renderTranscriptFooter", () => {
  afterEach(() => cleanup());

  it("shows Loading events when backfilling, regardless of tools-running", () => {
    render(renderTranscriptFooter({ backfilling: true, toolsRunning: true }));
    expect(screen.getByText("Loading events")).toBeDefined();
    expect(screen.queryByText("running")).toBeNull();
  });

  it("shows the running indicator when live and tools are running", () => {
    render(renderTranscriptFooter({ backfilling: false, toolsRunning: true }));
    expect(screen.getByText("running")).toBeDefined();
    expect(screen.queryByText("Loading events")).toBeNull();
  });

  it("renders nothing when live and idle", () => {
    const { container } = render(
      renderTranscriptFooter({ backfilling: false, toolsRunning: false })
    );
    expect(container.firstChild).toBeNull();
  });
});
