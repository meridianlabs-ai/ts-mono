// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testModelEvent } from "@tsmono/inspect-common/testing";
import type { TranscriptHostHeadroom } from "@tsmono/inspect-components/transcript";

import { apiScoutServer } from "../../../api/api-scout-server";
import { createStore, StoreProvider } from "../../../state/store";
import { createScanResultData } from "../../../test/objectFactories";
import type { ScannerInput } from "../../../types/api-types";

import { ResultBody } from "./ResultBody";

// The events view is irrelevant here — capture the headroom state ResultBody
// wires into it: the live `headroomHidden` prop and the setters it provides
// through the TranscriptHost.
let capturedHeadroomHidden: boolean | undefined;
let capturedHostHeadroom: TranscriptHostHeadroom | undefined;
vi.mock("../../timeline/components/TimelineEventsView", async () => {
  const { useTranscriptHost } =
    await import("@tsmono/inspect-components/transcript");
  return {
    TimelineEventsView: (props: { headroomHidden?: boolean }) => {
      capturedHeadroomHidden = props.headroomHidden;
      capturedHostHeadroom = useTranscriptHost().headroom;
      return <div data-testid="events-view" />;
    },
  };
});

afterEach(() => {
  cleanup();
  capturedHeadroomHidden = undefined;
  capturedHostHeadroom = undefined;
});

const eventsInput: ScannerInput = {
  input_type: "events",
  input: [testModelEvent({ uuid: "m1", timestamp: "2026-01-01T00:00:00Z" })],
};

const resultData = createScanResultData();

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

  it("provides the chrome's setters to the transcript through the host", () => {
    // Nav landings inside the transcript collapse this surface's chrome via
    // the host's headroom, the same way the transcript page's chrome works.
    mountBody(false);
    expect(capturedHostHeadroom?.setHidden).toBeTypeOf("function");
    expect(capturedHostHeadroom?.resetAnchor).toBeTypeOf("function");
    act(() => {
      capturedHostHeadroom!.setHidden!(true);
    });
    expect(capturedHeadroomHidden).toBe(true);
  });
});
