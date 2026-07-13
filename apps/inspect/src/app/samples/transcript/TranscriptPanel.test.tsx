// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://eval.example.org/eval-set/abc123?token=t"}
//
// Regression tests for the transcript copy-link URLs (the "copy link" button
// next to an event title). The shared components treat `getEventUrl` as a
// *shareable* URL and copy it to the clipboard verbatim, so TranscriptPanel
// must pass an absolute URL (origin + host path + hash route), while router
// navigation (markers, outline links) must still use the bare hash route.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoreState } from "../../../state/store";

import { TranscriptPanel } from "./TranscriptPanel";

// Must match the @vitest-environment-options url above: the page hosting the
// viewer, whose path is *not* "/" (e.g. Hawk embeds the viewer under
// /eval-set/<id>), so a missing origin/path prefix is visible in assertions.
const kHostPage = "https://eval.example.org/eval-set/abc123?token=t";

const kSampleRoute = "/logs/dir/file.eval/samples/sample/s1/1/transcript";
const kEventRoute = `${kSampleRoute}?event=event-1`;

vi.mock("../../../state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../state/store")>();
  const state = {
    sample: {
      eventFilter: { filteredTypes: [] },
      timelineSelected: null,
      activeTimelineIndex: 0,
      collapsedEvents: null,
      collapsedMode: null,
      selectedOutlineId: null,
    },
    sampleActions: {
      setTimelineSelected: () => undefined,
      setActiveTimelineIndex: () => undefined,
      setCollapsedEvents: () => undefined,
      collapseEvent: () => undefined,
      setSelectedOutlineId: () => undefined,
      setFilteredEventTypes: () => undefined,
    },
    app: { propertyBags: {} },
    appActions: { setPropertyValue: () => undefined },
    logs: { selectedLogFile: undefined, logDir: undefined },
  } as unknown as StoreState;
  return {
    ...actual,
    useStore: (selector: (s: StoreState) => unknown) => selector(state),
  };
});

// Stub the layout with a probe that exercises the three link paths exactly
// the way the real shared components do: `getEventUrl` feeds the copy button
// verbatim, the outline renders `renderLink(getEventUrl(id), ...)`, and
// markers call `onMarkerNavigate(id)`.
vi.mock("@tsmono/inspect-components/transcript", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@tsmono/inspect-components/transcript")
    >();
  const TranscriptLayout: typeof actual.TranscriptLayout = (props) => {
    const url = props.getEventUrl?.("event-1");
    return (
      <div>
        <div data-testid="copy-url">{url}</div>
        {url && props.outline?.renderLink
          ? props.outline.renderLink(url, <span>outline link</span>)
          : null}
        <button onClick={() => props.onMarkerNavigate?.("event-1")}>
          marker
        </button>
      </div>
    );
  };
  return { ...actual, TranscriptLayout };
});

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="router-location">
      {location.pathname}
      {location.search}
    </div>
  );
};

const renderPanel = () =>
  render(
    <MemoryRouter initialEntries={[kSampleRoute]}>
      <TranscriptPanel
        id="test-transcript"
        scrollRef={createRef<HTMLDivElement>()}
        events={[]}
      />
      <LocationProbe />
    </MemoryRouter>
  );

describe("TranscriptPanel linking", () => {
  afterEach(() => cleanup());

  it("hands the copy button an absolute URL including the host page prefix", () => {
    renderPanel();
    expect(screen.getByTestId("copy-url").textContent).toBe(
      `${kHostPage}#${kEventRoute}`
    );
  });

  it("outline links recover the relative hash route for in-app navigation", () => {
    renderPanel();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(kEventRoute);
  });

  it("marker navigation uses the relative hash route, not the absolute URL", () => {
    renderPanel();
    fireEvent.click(screen.getByText("marker"));
    expect(screen.getByTestId("router-location").textContent).toBe(kEventRoute);
  });
});
