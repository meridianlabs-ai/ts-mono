// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";

import { apiScoutServer } from "../../../api/api-scout-server";
import { createStore, StoreProvider } from "../../../state/store";
import type { ScannerInput } from "../../../types/api-types";
import type { ScanResultData } from "../../types";

import { ResultBody } from "./ResultBody";

// The events view is irrelevant here — capture the headroom state ResultBody
// wires into it.
let capturedHeadroomHidden: boolean | undefined;
vi.mock("../../timeline/components/TimelineEventsView", () => ({
  TimelineEventsView: (props: { headroomHidden?: boolean }) => {
    capturedHeadroomHidden = props.headroomHidden;
    return <div data-testid="events-view" />;
  },
}));

afterEach(() => {
  cleanup();
  capturedHeadroomHidden = undefined;
});

const eventsInput = {
  input_type: "events",
  input: [
    { event: "model", uuid: "m1", timestamp: "2026-01-01T00:00:00Z" },
  ] as unknown as Event[],
} as unknown as ScannerInput;

const resultData = { messageReferences: [] } as unknown as ScanResultData;

const mountBody = (showFind: boolean) => {
  const store = createStore(apiScoutServer());
  store.setState({ showFind });
  const view = render(
    <StoreProvider value={store}>
      <MemoryRouter>
        <ResultBody resultData={resultData} inputData={eventsInput} />
      </MemoryRouter>
    </StoreProvider>
  );
  return { ...view, store };
};

const scrollDown = (scroller: HTMLElement, top: number) => {
  Object.defineProperty(scroller, "scrollTop", {
    value: top,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(scroller, "scrollHeight", {
    value: 5000,
    configurable: true,
  });
  Object.defineProperty(scroller, "clientHeight", {
    value: 500,
    configurable: true,
  });
  act(() => {
    scroller.dispatchEvent(new Event("scroll"));
  });
};

describe("ResultBody chrome vs find-in-page", () => {
  it("does not collapse the chrome on find-driven scrolling", () => {
    // Find-next/prev scrolls matches into view programmatically; that must
    // not read as a user scroll direction and flicker the chrome — the same
    // contract as the transcript page, whose keyboard nav on this surface
    // already stands down while find is open.
    const { container } = mountBody(true);
    const scroller = container.querySelector<HTMLElement>(
      "[class*='scrollable']"
    );
    expect(scroller).not.toBeNull();
    expect(capturedHeadroomHidden).toBe(false);
    scrollDown(scroller!, 300);
    expect(capturedHeadroomHidden).toBe(false);
  });

  it("collapses the chrome on real downward scrolling (find closed)", () => {
    // Guards the harness itself: without find, the same scroll must collapse.
    const { container } = mountBody(false);
    const scroller = container.querySelector<HTMLElement>(
      "[class*='scrollable']"
    );
    expect(scroller).not.toBeNull();
    expect(capturedHeadroomHidden).toBe(false);
    scrollDown(scroller!, 300);
    expect(capturedHeadroomHidden).toBe(true);
  });
});
