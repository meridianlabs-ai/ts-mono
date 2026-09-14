// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { FC, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testApprovalEvent,
  testCompactionEvent,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testScoreEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
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
    // Default-on bands render in the chart (handoff 8a).
    expect(screen.getByText("MODEL & TOOL ACTIVITY")).toBeTruthy();
    expect(screen.getByText("CONTEXT SIZE")).toBeTruthy();
    expect(screen.getByText("TOKEN BURN")).toBeTruthy();
    // Working / waiting is the opt-in band.
    expect(screen.queryByText("WORKING / WAITING")).toBeNull();
    expect(screen.queryByText(/gap = waiting/)).toBeNull();
  });

  it("orders the chips activity → context → tokens → markers → working", () => {
    mountPanel();
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent.trim())
      .filter((text) =>
        [
          "Model & tool activity",
          "Context size",
          "Token burn",
          "Markers",
          "Working / waiting",
        ].includes(text)
      );
    expect(labels).toEqual([
      "Model & tool activity",
      "Context size",
      "Token burn",
      "Markers",
      "Working / waiting",
    ]);
  });

  it("toggles the opt-in band on and default bands off via chips", () => {
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "Working / waiting" }));
    expect(screen.getByText("WORKING / WAITING")).toBeTruthy();
    expect(screen.getByText(/gap = waiting/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Token burn/ }));
    expect(screen.queryByText("TOKEN BURN")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Context size/ }));
    expect(screen.queryByText("CONTEXT SIZE")).toBeNull();
  });

  it("hides the working band for logs without a working clock", () => {
    // Mid-vintage: timestamps present, working_start normalizer-filled 0,
    // no working_time — the band would read as all-waiting.
    mountPanel({
      events: [
        testModelEvent({
          timestamp: iso(0),
          completed: iso(10),
          working_start: 0,
          working_time: null,
          output: testModelOutput({
            usage: testModelUsage({
              input_tokens: 100,
              output_tokens: 10,
              total_tokens: 110,
            }),
          }),
        }),
      ],
    });
    expect(
      screen.queryByRole("button", { name: /Working \/ waiting/ })
    ).toBeNull();
    expect(screen.queryByText("WORKING / WAITING")).toBeNull();
    // The rest of the panel still renders.
    expect(screen.getByText("TOKEN BURN")).toBeTruthy();
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
    expect(screen.getByText("142k → 38k", { selector: "span" })).toBeTruthy();
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
    expect(screen.queryByText("142k → 38k", { selector: "span" })).toBeNull();

    // All resets.
    fireEvent.click(screen.getByRole("button", { name: /All 3/ }));
    expect(screen.getByText("142k → 38k", { selector: "span" })).toBeTruthy();
  });

  it("filters by search text", () => {
    mountPanel();
    const search = screen.getByPlaceholderText("filter by event or detail");
    fireEvent.change(search, { target: { value: "compacted" } });
    expect(screen.getByText("142k → 38k", { selector: "span" })).toBeTruthy();
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

describe("SampleActivityPanel burst labels", () => {
  it("declutters burst labels when parallel-tool bursts crowd the row", () => {
    // 40 turns of two overlapping tool calls each → 40 bursts across the
    // stubbed 1000px chart. Labeling every burst would smear; only those
    // with clear horizontal room render (hover keeps the rest).
    const events: Event[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = i * 10;
      events.push(
        testModelEvent({
          uuid: `m-${i}`,
          timestamp: iso(t0),
          completed: iso(t0 + 4),
          working_start: t0,
          working_time: 4,
        }),
        testToolEvent({
          uuid: `t-${i}a`,
          timestamp: iso(t0 + 4),
          completed: iso(t0 + 9),
          working_start: t0 + 4,
          function: "python",
        }),
        testToolEvent({
          uuid: `t-${i}b`,
          timestamp: iso(t0 + 5),
          completed: iso(t0 + 10),
          working_start: t0 + 4,
          function: "python",
        })
      );
    }
    const { container } = mountPanel({ events });

    const labels = container.querySelectorAll("[class*='burstLabel']");
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThan(40);
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

describe("SampleActivityPanel agent gutter (multi-conversation)", () => {
  /** Two conversations: "react" hands off to a spawned "analyst". */
  const multiAgentEvents = (): Event[] => {
    const usage = (input: number) =>
      testModelOutput({
        usage: testModelUsage({
          input_tokens: input,
          output_tokens: 100,
          total_tokens: input + 100,
        }),
      });
    return [
      testSpanBeginEvent({
        id: "react",
        name: "react",
        type: "agent",
        timestamp: iso(0),
      }),
      testModelEvent({
        uuid: "m-react-1",
        timestamp: iso(0),
        completed: iso(5),
        working_start: 0,
        working_time: 5,
        model: "opus",
        span_id: "react",
        output: usage(1000),
      }),
      testToolEvent({
        uuid: "t-transfer",
        timestamp: iso(5),
        completed: iso(20),
        working_start: 5,
        working_time: 15,
        function: "transfer_to_analyst",
        span_id: "react",
      }),
      testSpanBeginEvent({
        id: "tool",
        name: "transfer_to_analyst",
        type: "tool",
        parent_id: "react",
        timestamp: iso(5),
      }),
      testSpanBeginEvent({
        id: "analyst",
        name: "analyst",
        type: "agent",
        parent_id: "tool",
        timestamp: iso(6),
      }),
      testModelEvent({
        uuid: "m-analyst-1",
        timestamp: iso(6),
        completed: iso(18),
        working_start: 6,
        working_time: 12,
        model: "haiku",
        span_id: "analyst",
        output: usage(500),
      }),
      testSpanEndEvent({ id: "analyst", timestamp: iso(19) }),
      testSpanEndEvent({ id: "tool", timestamp: iso(20) }),
      testModelEvent({
        uuid: "m-react-2",
        timestamp: iso(20),
        completed: iso(30),
        working_start: 20,
        working_time: 10,
        model: "opus",
        span_id: "react",
        output: usage(2000),
      }),
      testSpanEndEvent({ id: "react", timestamp: iso(30) }),
    ];
  };

  it("renders a checkbox gutter row per conversation with stacked burn layers", () => {
    const { container } = mountPanel({ events: multiAgentEvents() });
    expect(screen.getByRole("checkbox", { name: "Hide react" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Hide analyst" })).toBeTruthy();
    expect(screen.getByText("haiku · sub-agent")).toBeTruthy();
    expect(screen.getByText(/2 conversations · 3 model turns/)).toBeTruthy();
    // One stacked layer per conversation, no single dark total line.
    expect(container.querySelectorAll("[class*='tokenLayer']")).toHaveLength(4);
    expect(container.querySelectorAll("[class*='tokenSeries']")).toHaveLength(
      0
    );
    // The parent's hand-off renders as the dotted awaiting thread.
    expect(container.querySelectorAll("[class*='blockedThread']")).toHaveLength(
      1
    );
    expect(screen.getByText(/stacked by conversation/)).toBeTruthy();
  });

  it("hides a conversation's rows and layers when unchecked", () => {
    const { container } = mountPanel({ events: multiAgentEvents() });
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide analyst" }));
    expect(screen.getByRole("checkbox", { name: "Show analyst" })).toBeTruthy();
    expect(screen.getByText(/1 of 2 shown/)).toBeTruthy();
    // Token band: one layer (+ its edge) remains; the total headline notes
    // the shown share.
    expect(container.querySelectorAll("[class*='tokenLayer']")).toHaveLength(2);
    expect(screen.getByText(/shown · stacked by conversation/)).toBeTruthy();
  });

  it("keeps the single-conversation label and 30px gutter for one row", () => {
    mountPanel();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("test-model")).toBeTruthy();
  });
});

describe("SampleActivityPanel hover (shared cursor + tooltip)", () => {
  /** The hovered span rect for a given event uuid — spans carry no text,
   *  so the click-through class is the one DOM hook. */
  const spanRects = (container: HTMLElement) => [
    ...container.querySelectorAll(
      "rect[class*='modelSpan'], rect[class*='toolSpan']"
    ),
  ];

  it("moves the cursor with the pointer: hairline, axis pill, read-out dots", () => {
    const { container } = mountPanel();
    const plot = container.querySelector("rect[class*='plotHit']");
    if (!(plot instanceof SVGElement))
      throw new Error("expected the plot hit rect");
    fireEvent.mouseMove(plot, { clientX: 500, clientY: 40 });

    expect(container.querySelectorAll("[class*='cursorLine']")).toHaveLength(1);
    expect(
      container.querySelector("[class*='cursorPillText']")?.textContent
    ).toMatch(/\d/);
    // One read-out dot per curve band (context + tokens) for the one row.
    expect(
      container.querySelectorAll("[class*='readoutDot']").length
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows one tooltip card for a hovered span after the delay, with click-through", () => {
    vi.useFakeTimers();
    try {
      const onOpenEvent = vi.fn();
      const { container } = mountPanel({ onOpenEvent });
      const failedTool = container.querySelector("rect[class*='failedSpan']");
      if (!(failedTool instanceof SVGElement))
        throw new Error("expected the failed tool span");
      fireEvent.mouseEnter(failedTool);
      // Not yet: 120ms show delay.
      expect(screen.queryByText("tool call")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.getByText("tool call")).toBeTruthy();
      expect(screen.getByText("failed")).toBeTruthy();
      // The error message appears in the history row and now in the card.
      expect(screen.getAllByText(/exit 127/).length).toBeGreaterThanOrEqual(2);
      // The hovered rect outlines.
      expect(failedTool.getAttribute("class")).toContain("spanHovered");

      fireEvent.click(
        screen.getAllByRole("button", { name: "open in transcript →" })[0]!
      );
      expect(onOpenEvent).toHaveBeenCalledWith("tool-fail", expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a model turn's tokens and stop reason", () => {
    vi.useFakeTimers();
    try {
      const { container } = mountPanel();
      const model = spanRects(container).find((rect) =>
        rect.getAttribute("class")?.includes("modelSpan")
      );
      if (!(model instanceof SVGElement))
        throw new Error("expected a model span");
      fireEvent.mouseEnter(model);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.getByText("Model turn 1")).toBeTruthy();
      expect(screen.getByText("input")).toBeTruthy();
      expect(screen.getByText("1,000")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches the gutter legend to AT CURSOR values on a multi-conversation sample", () => {
    const events: Event[] = [
      testSpanBeginEvent({
        id: "a",
        name: "orchestrator",
        type: "agent",
        timestamp: iso(0),
      }),
      testModelEvent({
        uuid: "a1",
        timestamp: iso(0),
        completed: iso(10),
        working_start: 0,
        working_time: 10,
        span_id: "a",
        output: testModelOutput({
          usage: testModelUsage({
            input_tokens: 1000,
            output_tokens: 100,
            total_tokens: 1100,
          }),
        }),
      }),
      testSpanBeginEvent({
        id: "b",
        name: "researcher",
        type: "agent",
        parent_id: "a",
        timestamp: iso(10),
      }),
      testModelEvent({
        uuid: "b1",
        timestamp: iso(10),
        completed: iso(20),
        working_start: 10,
        working_time: 10,
        span_id: "b",
        output: testModelOutput({
          usage: testModelUsage({
            input_tokens: 500,
            output_tokens: 50,
            total_tokens: 550,
          }),
        }),
      }),
      testSpanEndEvent({ id: "b", timestamp: iso(20) }),
      testSpanEndEvent({ id: "a", timestamp: iso(20) }),
    ];
    const { container } = mountPanel({ events });
    expect(screen.queryByText("AT CURSOR")).toBeNull();
    const plot = container.querySelector("rect[class*='plotHit']");
    if (!(plot instanceof SVGElement))
      throw new Error("expected the plot hit rect");
    // Pointer at the plot's left edge: before either conversation burned.
    fireEvent.mouseMove(plot, { clientX: 130, clientY: 40 });
    expect(screen.getAllByText("AT CURSOR").length).toBeGreaterThan(0);
  });
});

describe("SampleActivityPanel Turns axis", () => {
  const toTurns = () =>
    fireEvent.click(screen.getByRole("button", { name: "Turns" }));

  it("tiles one column per model turn and relabels the axis TURN", () => {
    const { container } = mountPanel();
    expect(screen.queryByText("TURN")).toBeNull();
    toTurns();
    expect(screen.getByText("TURN")).toBeTruthy();
    // One turn (model-1 + its failed bash) → one tick.
    expect(screen.getByText("1", { selector: "text" })).toBeTruthy();
    // Column rects carry the seam class, no rounding.
    const columnRects = container.querySelectorAll("rect[class*='turnRect']");
    expect(columnRects.length).toBe(2);
    expect(columnRects[0]?.getAttribute("rx")).toBeNull();
    // Wall clock is one click away and the choice persists in the bag.
    expect(
      screen.getByRole("button", { name: "Turns" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("disables the working band in Turns mode without touching its override", () => {
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "Working / waiting" }));
    expect(screen.getByText("WORKING / WAITING")).toBeTruthy();

    toTurns();
    expect(screen.queryByText("WORKING / WAITING")).toBeNull();
    const chip = screen.getByRole("button", { name: /Working \/ waiting/ });
    expect(chip.hasAttribute("disabled")).toBe(true);
    expect(chip.textContent).toContain("wall clock only");

    // Back on the wall clock the band returns — the override was kept on.
    fireEvent.click(screen.getByRole("button", { name: /^Wall clock$/ }));
    expect(screen.getByText("WORKING / WAITING")).toBeTruthy();
  });

  it("draws a rejected call as a dashed ghost slot", () => {
    const events: Event[] = [
      testModelEvent({
        uuid: "m1",
        timestamp: iso(0),
        completed: iso(5),
        working_start: 0,
        working_time: 5,
        output: testModelOutput({
          usage: testModelUsage({
            input_tokens: 100,
            output_tokens: 10,
            total_tokens: 110,
          }),
        }),
      }),
      testApprovalEvent({
        uuid: "rej",
        timestamp: iso(6),
        decision: "reject",
        approver: "human",
      }),
    ];
    const { container } = mountPanel({ events });
    toTurns();
    expect(container.querySelectorAll("[class*='ghostSpan']")).toHaveLength(1);
    expect(screen.getByText(/rejected · no tool run/)).toBeTruthy();
    expect(
      screen.getByText(/1 model turns · 0 tool calls · 1 rejected/)
    ).toBeTruthy();
  });

  it("falls back to the per-pixel strip binned by turn at density", () => {
    // Two conversations × 200 one-second turns on the stubbed 1000px chart:
    // each row stays under 1 span per 3px on the wall clock, but the 400
    // interleaved turn columns exceed it.
    const events: Event[] = [
      testSpanBeginEvent({
        id: "a",
        name: "alpha",
        type: "agent",
        timestamp: iso(0),
      }),
      testSpanBeginEvent({
        id: "b",
        name: "beta",
        type: "agent",
        timestamp: iso(0),
      }),
    ];
    for (let i = 0; i < 400; i++) {
      events.push(
        testModelEvent({
          uuid: `m-${i}`,
          timestamp: iso(i),
          completed: iso(i + 0.5),
          working_start: i,
          working_time: 0.5,
          span_id: i % 2 === 0 ? "a" : "b",
          output: testModelOutput({
            usage: testModelUsage({
              input_tokens: 10,
              output_tokens: 1,
              total_tokens: 11,
            }),
          }),
        })
      );
    }
    vi.useFakeTimers();
    const { container } = mountPanel({ events });
    expect(screen.queryByText(/per-pixel occupancy/)).toBeNull();
    toTurns();
    expect(screen.getByText(/per-pixel occupancy/)).toBeTruthy();
    expect(container.querySelectorAll("rect[class*='turnRect']")).toHaveLength(
      0
    );
    // ~2px columns: ticks thin to every 100th turn.
    const tickLabels = [
      ...container.querySelectorAll("text[class*='axisLabel']"),
    ].map((tick) => tick.textContent);
    expect(tickLabels).toEqual(["TURN", "1", "100", "200", "300", "400"]);
    // A bin hover reads a turn range.
    const hit = container.querySelector("rect[class*='densityHit']");
    if (!(hit instanceof SVGElement))
      throw new Error("expected the density hit rect");
    fireEvent.mouseMove(hit, { clientX: 500, clientY: 60 });
    try {
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.getByText(/turns \d+–\d+ · \d+ model/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
