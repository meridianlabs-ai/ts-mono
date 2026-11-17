// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testScore } from "@tsmono/inspect-common/testing";
import {
  ComponentNavigationProvider,
  ExtendedFindProvider,
  FindBand,
  FindTargetProvider,
} from "@tsmono/react/components";
import { stubFindHighlightApi } from "@tsmono/react/testing";

import { startTestApp, stopTestApp, TestApp } from "../../../test/testApp";

import { ScansSidebarPanel } from "./ScansSidebarPanel";

describe("ScansSidebarPanel", () => {
  beforeEach(() => {
    startTestApp();
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    await stopTestApp();
  });

  it("keeps grep excerpts of the transcript out of in-page Find", async () => {
    stubFindHighlightApi(vi.stubGlobal);
    render(
      <TestApp path="/">
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <ScansSidebarPanel
            scores={{
              error_keywords: testScore({
                value: 1,
                explanation:
                  '[M43]: ...decoded_text) except Exception as e: print(f"**Error** decoding: {e}")',
                metadata: {
                  scanner_references: [
                    { type: "message", id: "m43", cite: "[M43]" },
                  ],
                },
              }),
            }}
            makeCiteUrl={() => undefined}
            selected="error_keywords"
            onSelectedChange={() => {}}
            onClose={() => {}}
          />
        </ComponentNavigationProvider>
      </TestApp>
    );
    await screen.findByText(/decoding: \{e\}/);
    // The same text outside the panel, standing in for the transcript.
    render(
      <ExtendedFindProvider>
        <FindTargetProvider>
          <FindBand onClose={() => {}} />
          <p>{'print(f"Error decoding: {e}")'}</p>
        </FindTargetProvider>
      </ExtendedFindProvider>
    );

    const input = screen.getByPlaceholderText("Find");
    fireEvent.change(input, { target: { value: "decoding: {e}" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("find-band-match-count").textContent).toBe(
      "1 of 1"
    );
  });
});
