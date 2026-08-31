// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { FC, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testCompactionEvent,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testScoreEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeReactiveStateStore } from "@tsmono/react/testing";

import { SampleActivityPanel } from "./SampleActivityPanel";

/** ResizeObserver that reports a real size synchronously on observe: the
 *  chart renders nothing at width 0, and the virtualizer computes an empty
 *  range from a zero-height scroll rect. jsdom provides neither. */
class ImmediateResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: globalThis.Element) {
    const size: ResizeObserverSize = { inlineSize: 1000, blockSize: 600 };
    const rect = new DOMRectReadOnly(0, 0, 1000, 600);
    this.callback(
      [
        {
          target,
          contentRect: rect,
          borderBoxSize: [size],
          contentBoxSize: [size],
          devicePixelContentBoxSize: [size],
        },
      ],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}

const kRunStart = Date.parse("2025-01-15T10:00:00.000Z") / 1000;
const iso = (sec: number): string =>
  new Date((kRunStart + sec) * 1000).toISOString();

const fixtureEvents = (): Event[] => [
  testModelEvent({
    uuid: "model-1",
    timestamp: iso(0),
    completed: iso(10),
    working_start: 0,
    working_time: 10,
    model: "test-model",
    output: testModelOutput({
      usage: testModelUsage({
        input_tokens: 1000,
        output_tokens: 200,
        total_tokens: 1200,
      }),
    }),
  }),
  testToolEvent({
    uuid: "tool-fail",
    timestamp: iso(10),
    completed: iso(14),
    working_start: 10,
    working_time: 4,
    function: "bash",
    error: { type: "unknown", message: "exit 127" },
  }),
  testCompactionEvent({
    uuid: "compact-1",
    timestamp: iso(20),
    working_start: 14,
    tokens_before: 142_000,
    tokens_after: 38_000,
  }),
  testScoreEvent({
    uuid: "score-1",
    timestamp: iso(30),
    working_start: 15,
    scorer: "test_scorer",
  }),
];

interface HarnessProps {
  events?: Event[];
  onOpenEvent?: (uuid: string, event: unknown) => void;
}

const Harness: FC<HarnessProps> = ({
  events = fixtureEvents(),
  onOpenEvent,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={scrollRef} style={{ height: 500, overflow: "auto" }}>
      <SampleActivityPanel
        events={events}
        startedAt={iso(0)}
        completedAt={iso(30)}
        scrollRef={scrollRef}
        persistScope="test-log:1:1"
        onOpenEvent={onOpenEvent}
      />
    </div>
  );
};

const mountPanel = (props: HarnessProps = {}) => {
  const { hooks } = makeReactiveStateStore();
  return render(
    <ComponentStateProvider hooks={hooks}>
      <Harness {...props} />
    </ComponentStateProvider>
  );
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ImmediateResizeObserver);
  // jsdom has no scrollTo; VirtualList calls it during mount.
  Element.prototype.scrollTo = function () {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SampleActivityPanel band chips", () => {
  it("lights the curated default band set", () => {
    mountPanel();
    // Default-on bands render in the chart.
    expect(screen.getByText("WORKING / WAITING")).toBeTruthy();
    expect(screen.getByText("TOKEN BURN")).toBeTruthy();
    // Opt-in bands stay off until their chip is toggled.
    expect(screen.queryByText("CONTEXT SIZE")).toBeNull();
    expect(screen.queryByText("MODEL & TOOL ACTIVITY")).toBeNull();
  });

  it("toggles opt-in bands on and default bands off via chips", () => {
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "Context size" }));
    expect(screen.getByText("CONTEXT SIZE")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Model & tool activity" })
    );
    expect(screen.getByText("MODEL & TOOL ACTIVITY")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Token burn/ }));
    expect(screen.queryByText("TOKEN BURN")).toBeNull();
  });

  it("hides the whole panel for events without timestamps", () => {
    const { container } = mountPanel({
      events: [testModelEvent({ timestamp: "" })],
    });
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByText("History")).toBeNull();
  });
});

describe("SampleActivityPanel history list", () => {
  it("renders one row per incident with category pills", () => {
    mountPanel();
    expect(screen.getByText(/exit 127/)).toBeTruthy();
    expect(screen.getByText("142k → 38k")).toBeTruthy();
    expect(screen.getByText(/scorer test_scorer/)).toBeTruthy();
    // Filter pills carry live counts.
    expect(screen.getByRole("button", { name: /Errors 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Compactions 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Scores 1/ })).toBeTruthy();
  });

  it("filters additively via category pills", () => {
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: /Errors 1/ }));
    expect(screen.getByText(/exit 127/)).toBeTruthy();
    expect(screen.queryByText(/scorer test_scorer/)).toBeNull();

    // Additive: selecting Scores too widens rather than replaces.
    fireEvent.click(screen.getByRole("button", { name: /Scores 1/ }));
    expect(screen.getByText(/scorer test_scorer/)).toBeTruthy();
    expect(screen.queryByText("142k → 38k")).toBeNull();

    // All resets.
    fireEvent.click(screen.getByRole("button", { name: /All 3/ }));
    expect(screen.getByText("142k → 38k")).toBeTruthy();
  });

  it("filters by search text", () => {
    mountPanel();
    const search = screen.getByPlaceholderText("filter by event or detail");
    fireEvent.change(search, { target: { value: "compacted" } });
    expect(screen.getByText("142k → 38k")).toBeTruthy();
    expect(screen.queryByText(/exit 127/)).toBeNull();
  });

  it("clicks through to the transcript via event uuid", () => {
    const onOpenEvent = vi.fn();
    mountPanel({ onOpenEvent });
    const errorRow = screen.getByText(/exit 127/).closest("[role='button']");
    if (!(errorRow instanceof HTMLElement)) {
      throw new Error("expected the error row to render");
    }
    fireEvent.click(
      within(errorRow).getByRole("button", {
        name: "open in transcript →",
      })
    );
    expect(onOpenEvent).toHaveBeenCalledWith("tool-fail", expect.anything());
  });
});

describe("SampleActivityPanel marker ↔ list link", () => {
  it("marker click widens a filter that would hide its row", () => {
    mountPanel();
    // Narrow to Scores — the error row disappears.
    fireEvent.click(screen.getByRole("button", { name: /Scores 1/ }));
    expect(screen.queryByText(/exit 127/)).toBeNull();

    // Click the error glyph on the rail — the filter widens to include it.
    fireEvent.click(screen.getByRole("button", { name: "Tool bash errored" }));
    expect(screen.getByText(/exit 127/)).toBeTruthy();
  });

  it("hovering a glyph washes its history row", () => {
    mountPanel();
    const glyph = screen.getByRole("button", { name: "Tool bash errored" });
    fireEvent.mouseEnter(glyph);
    const row = screen.getByText(/exit 127/).closest("[role='button']");
    expect(row?.className).toContain("washError");
    fireEvent.mouseLeave(glyph);
    const rowAfter = screen.getByText(/exit 127/).closest("[role='button']");
    expect(rowAfter?.className).not.toContain("washError");
  });
});
