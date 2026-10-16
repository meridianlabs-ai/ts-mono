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
import { useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isHostedEnvironment } from "@tsmono/util";

import { testClientAPI } from "../../../client/api/testClientApi";
import { startTestApp, stopTestApp, TestApp } from "../../../test/testApp";

import { TranscriptPanel } from "./TranscriptPanel";

// Host page the viewer is embedded in, from the @vitest-environment-options
// URL above: a non-root path with a query (e.g. Hawk's /eval-set/<id>), so a
// missing origin/path/query prefix is visible in assertions.
const kHostPage = `${window.location.origin}${window.location.pathname}${window.location.search}`;

const kSampleRoute = "/logs/dir/file.eval/samples/sample/s1/1/transcript";
const kEventRoute = `${kSampleRoute}?event=event-1`;

// The hosted check reads `location.hostname`, which a jsdom test file can't
// change between tests; stub it to cover both sides.
vi.mock("@tsmono/util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tsmono/util")>();
  return { ...actual, isHostedEnvironment: vi.fn(() => true) };
});

// Stub the layout with a probe (the real one is a virtualized list, which
// renders no rows without layout in jsdom) that exercises the three link
// paths exactly the way the real shared components do: `getEventUrl` feeds the copy button
// verbatim (gated on `linkingEnabled`), the outline renders
// `renderLink(getEventUrl(id), ...)` ungated, and markers call
// `onMarkerNavigate(id)`.
vi.mock("@tsmono/inspect-components/transcript", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@tsmono/inspect-components/transcript")
    >();
  const TranscriptLayout: typeof actual.TranscriptLayout = (props) => {
    // Mirror the real components: EventPanel gates the copy button on
    // `linkingEnabled`; the outline consumes `getEventUrl` ungated.
    const copyUrl =
      props.linkingEnabled && props.getEventUrl
        ? props.getEventUrl("event-1")
        : undefined;
    const outlineUrl = props.getEventUrl?.("event-1");
    return (
      <div>
        <div data-testid="copy-url">{copyUrl}</div>
        {outlineUrl && props.outline?.renderLink
          ? props.outline.renderLink(outlineUrl, <span>outline link</span>)
          : null}
        <button onClick={() => props.timeline?.onMarkerNavigate?.("event-1")}>
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
    <TestApp path={kSampleRoute}>
      <TranscriptPanel
        selectionKey="test-visit"
        id="test-transcript"
        scrollRef={createRef<HTMLDivElement>()}
        events={[]}
      />
      <LocationProbe />
    </TestApp>
  );

describe("TranscriptPanel linking", () => {
  beforeEach(() => {
    vi.mocked(isHostedEnvironment).mockReturnValue(true);
    // The sample's log never loads: the links are built from the route.
    startTestApp({
      api: testClientAPI({ get_log_details: () => new Promise(() => {}) }),
    });
  });

  afterEach(async () => {
    cleanup();
    await stopTestApp();
  });

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

  it("hides the event copy link outside hosted environments", () => {
    vi.mocked(isHostedEnvironment).mockReturnValue(false);
    renderPanel();
    // Copy button gets no URL (EventPanel gates it on linkingEnabled)...
    expect(screen.getByTestId("copy-url").textContent).toBe("");
    // ...but in-app outline navigation still works.
    expect(screen.getByRole("link").getAttribute("href")).toBe(kEventRoute);
  });
});
