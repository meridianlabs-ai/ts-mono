// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testModelEvent } from "@tsmono/inspect-common/testing";
import { ComponentIconProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeReactiveStateHooks, testIcons } from "@tsmono/react/testing";

import { EventPanel } from "./event/EventPanel";
import {
  kEmptyTranscriptHost,
  TranscriptHostProvider,
  useTranscriptHost,
  type TranscriptHost,
} from "./host";
import { OutlineRow } from "./outline/OutlineRow";
import { eventNode } from "./testHelpers";

afterEach(cleanup);

const StateWrapper = ({ children }: { children: React.ReactNode }) => (
  <ComponentStateProvider hooks={makeReactiveStateHooks()}>
    <ComponentIconProvider icons={testIcons}>{children}</ComponentIconProvider>
  </ComponentStateProvider>
);

describe("useTranscriptHost", () => {
  const probe = () => {
    const seen = vi.fn<(host: TranscriptHost) => void>();
    const Probe = () => {
      seen(useTranscriptHost());
      return null;
    };
    return { seen, Probe };
  };

  it("returns the empty host when no provider is mounted", () => {
    const { seen, Probe } = probe();
    render(<Probe />);
    expect(seen).toHaveBeenCalledWith(kEmptyTranscriptHost);
    expect(seen.mock.calls[0]?.[0]).toEqual({});
  });

  it("returns the provided host", () => {
    const host: TranscriptHost = { urls: { linkingEnabled: true } };
    const { seen, Probe } = probe();
    render(
      <TranscriptHostProvider host={host}>
        <Probe />
      </TranscriptHostProvider>
    );
    expect(seen.mock.calls[0]?.[0]).toBe(host);
  });
});

describe("EventPanel reads the host", () => {
  const renderPanel = (host: TranscriptHost | undefined) => {
    const panel = (
      <EventPanel
        eventNodeId="ev-1"
        title="Model"
        turnNav={{ turnNumber: 1, totalTurns: 3 }}
        eventCallbacks={{
          getEventFocusUrl: (eventId) => `#/focus?event=${eventId}`,
        }}
      >
        <div data-name="Summary">body</div>
      </EventPanel>
    );
    return render(
      host ? (
        <TranscriptHostProvider host={host}>{panel}</TranscriptHostProvider>
      ) : (
        panel
      ),
      { wrapper: StateWrapper }
    );
  };

  it("shows the copy-link button only when the host enables linking", () => {
    const getEventUrl = (eventId: string) => `https://x.test/#/e/${eventId}`;
    renderPanel({ urls: { getEventUrl, linkingEnabled: true } });
    expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
  });

  it("hides the copy-link button when linking is disabled or there is no host", () => {
    const getEventUrl = (eventId: string) => `https://x.test/#/e/${eventId}`;
    renderPanel({ urls: { getEventUrl, linkingEnabled: false } });
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    cleanup();
    renderPanel(undefined);
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("plain-clicks the focus link through the host's onOpenEventFocus", () => {
    const onOpenEventFocus = vi.fn<(route: string) => void>();
    renderPanel({ navigation: { onOpenEventFocus } });
    const link = screen.getByRole("link", { name: "Open focused turn view" });
    expect(link.getAttribute("href")).toBe("#/focus?event=ev-1");
    // With an in-window handler the anchor no longer targets a new tab.
    expect(link.getAttribute("target")).toBeNull();
    fireEvent.click(link, { button: 0 });
    expect(onOpenEventFocus).toHaveBeenCalledWith("#/focus?event=ev-1");
  });

  it("falls back to a new-tab focus link without a host", () => {
    renderPanel(undefined);
    const link = screen.getByRole("link", { name: "Open focused turn view" });
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

describe("OutlineRow reads the host", () => {
  const node = () =>
    eventNode(testModelEvent({ timestamp: "2026-01-01T00:00:00Z" }));

  it("links through urls.getEventUrl regardless of linkingEnabled", () => {
    const n = node();
    render(
      <TranscriptHostProvider
        host={{
          urls: {
            getEventUrl: (id) => `https://x.test/#/e/${id}`,
            linkingEnabled: false,
          },
        }}
      >
        <OutlineRow node={n} />
      </TranscriptHostProvider>
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      `https://x.test/#/e/${n.id}`
    );
  });

  it("renders the link through outline.renderLink when provided", () => {
    const n = node();
    render(
      <TranscriptHostProvider
        host={{
          urls: { getEventUrl: (id) => `https://x.test/#/e/${id}` },
          outline: {
            renderLink: (url, children) => (
              <a href={url} data-testid="custom-link">
                {children}
              </a>
            ),
          },
        }}
      >
        <OutlineRow node={n} />
      </TranscriptHostProvider>
    );
    expect(screen.getByTestId("custom-link").getAttribute("href")).toBe(
      `https://x.test/#/e/${n.id}`
    );
  });

  it("renders plain text without a host", () => {
    render(<OutlineRow node={node()} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("model")).toBeDefined();
  });
});
