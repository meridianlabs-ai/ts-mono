// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeEvents } from "@tsmono/inspect-common/normalize";
import {
  testApprovalEvent,
  testCompactionEvent,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSpanBeginEvent,
  testSpanEndEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { Event, ModelEvent } from "@tsmono/inspect-common/types";

import {
  ActivityChart,
  ActivityChartProps,
  turnGridSeparators,
  turnGridStep,
} from "./ActivityChart";
import { deriveActivityData } from "./activityData";
import { ImmediateResizeObserver, iso } from "./testHelpers";

// A full-height span rect (a burst lane is thinner).
const kAgentSpanHeight = 11;

/** The plot's horizontal extent, read from the drawn axis baseline (the
 *  widest horizontal axis line) so the tests don't hardcode the gutter. */
const plotBounds = (
  container: HTMLElement
): { left: number; right: number; width: number } => {
  let left = 0;
  let right = 0;
  for (const line of container.querySelectorAll("line[class*='axisLine']")) {
    if (attr(line, "y1") !== attr(line, "y2")) continue;
    if (attr(line, "x2") - attr(line, "x1") > right - left) {
      left = attr(line, "x1");
      right = attr(line, "x2");
    }
  }
  if (right <= left) throw new Error("expected a drawn axis baseline");
  return { left, right, width: right - left };
};

const modelCall = (opts: {
  start: number;
  end: number;
  working?: number;
  uuid?: string;
  spanId?: string;
  input?: number;
}): ModelEvent =>
  testModelEvent({
    uuid: opts.uuid,
    span_id: opts.spanId,
    timestamp: iso(opts.start),
    completed: iso(opts.end),
    working_start: opts.start,
    working_time: opts.working ?? opts.end - opts.start,
    output: testModelOutput({
      usage: testModelUsage({
        input_tokens: opts.input ?? 100,
        output_tokens: 0,
        total_tokens: opts.input ?? 100,
      }),
    }),
  });

const renderChart = (
  events: Event[],
  props: Partial<ActivityChartProps> = {}
) => {
  const data = deriveActivityData({ events });
  if (!data.window) throw new Error("expected a time window");
  return render(
    <ActivityChart
      data={data}
      window={data.window}
      showWorking={false}
      showMarkers={false}
      showTokens
      showContext
      showModelTool
      selectedKey={null}
      {...props}
    />
  );
};

const attr = (element: Element | null, name: string): number =>
  Number(element?.getAttribute(name));

/** The x coordinates of a path's M/L commands, in order. */
const pathXs = (d: string): number[] =>
  [...d.matchAll(/[ML] ([\d.]+) /g)].map((m) => Number(m[1]));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ImmediateResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ActivityChart Turns mode geometry", () => {
  it("splits a column into equal model and tool halves whatever the working time", () => {
    // 10s of model work, then a tool that worked 2s of its 90s wall span:
    // the column still splits 50/50 (design owner 2026-09-15) — the ratio
    // is Wall clock's and the tooltip's to show.
    const { container } = renderChart(
      [
        modelCall({ start: 0, end: 10, uuid: "m" }),
        testToolEvent({
          uuid: "t",
          timestamp: iso(10),
          completed: iso(100),
          working_start: 10,
          working_time: 2,
        }),
      ],
      { axisMode: "turns" }
    );
    const { left, width } = plotBounds(container);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "x")).toBeCloseTo(left);
    expect(attr(model, "width")).toBeCloseTo(width / 2);
    const tool = container.querySelector("rect[class*='toolSpan']");
    expect(attr(tool, "x")).toBeCloseTo(left + width / 2);
    expect(attr(tool, "width")).toBeCloseTo(width / 2);
  });

  it("reserves an empty tool half for a turn with no tool call", () => {
    // Strict grid (design owner 2026-09-15): the model rect is the left
    // half whether or not a tool ran; the right half stays empty.
    const { container } = renderChart(
      [modelCall({ start: 0, end: 10, uuid: "m" })],
      { axisMode: "turns" }
    );
    const { left, width } = plotBounds(container);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "x")).toBeCloseTo(left);
    expect(attr(model, "width")).toBeCloseTo(width / 2);
    expect(container.querySelectorAll("rect[class*='turnRect']")).toHaveLength(
      1
    );
    expect(container.querySelector("rect[class*='toolSpan']")).toBeNull();
    expect(container.querySelector("rect[class*='ghostSpan']")).toBeNull();
  });

  it("splits sequential tools into equal slots whatever their working time", () => {
    // 2 s and 18 s of tool work: two quarter-column slots, not a 1:9
    // share — the durations stay on the tooltip.
    const { container } = renderChart(
      [
        modelCall({ start: 0, end: 10, uuid: "m" }),
        testToolEvent({
          uuid: "t1",
          timestamp: iso(10),
          completed: iso(12),
          working_start: 10,
          working_time: 2,
        }),
        testToolEvent({
          uuid: "t2",
          timestamp: iso(12),
          completed: iso(30),
          working_start: 12,
          working_time: 18,
        }),
      ],
      { axisMode: "turns" }
    );
    const { left, width } = plotBounds(container);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "width")).toBeCloseTo(width / 2);
    const tools = [...container.querySelectorAll("rect[class*='toolSpan']")];
    expect(tools).toHaveLength(2);
    expect(attr(tools[0]!, "x")).toBeCloseTo(left + width / 2);
    expect(attr(tools[0]!, "width")).toBeCloseTo(width / 4);
    expect(attr(tools[1]!, "x")).toBeCloseTo(left + (3 * width) / 4);
    expect(attr(tools[1]!, "width")).toBeCloseTo(width / 4);
    for (const tool of tools) {
      expect(attr(tool, "height")).toBe(kAgentSpanHeight);
    }
  });

  it("gives a rejected call the same slot as the executed tool beside it", () => {
    const { container } = renderChart(
      [
        modelCall({ start: 0, end: 10, uuid: "m" }),
        testToolEvent({
          uuid: "t",
          timestamp: iso(10),
          completed: iso(12),
          working_start: 10,
          working_time: 2,
        }),
        testApprovalEvent({
          uuid: "r",
          timestamp: iso(12.5),
          decision: "reject",
        }),
      ],
      { axisMode: "turns" }
    );
    const { left, width } = plotBounds(container);
    const tool = container.querySelector("rect[class*='toolSpan']");
    expect(attr(tool, "x")).toBeCloseTo(left + width / 2);
    expect(attr(tool, "width")).toBeCloseTo(width / 4);
    const ghost = container.querySelector("rect[class*='ghostSpan']");
    // The ghost is inset 0.75 px each side for its own dashed stroke.
    expect(attr(ghost, "x")).toBeCloseTo(left + (3 * width) / 4 + 0.75);
    expect(attr(ghost, "width")).toBeCloseTo(width / 4 - 1.5);
  });

  it("keeps a burst's sub-lanes inside its equal slot next to a sequential tool", () => {
    // A two-call burst (14 s of work) then a 1 s tool: two equal
    // quarter-column slots, the burst's lanes stacked inside the first.
    const { container } = renderChart(
      [
        modelCall({ start: 0, end: 1, uuid: "m" }),
        ...Array.from({ length: 2 }, (_, i) =>
          testToolEvent({
            uuid: `b${i}`,
            timestamp: iso(2 + i * 0.1),
            completed: iso(9),
            working_start: 2,
            working_time: 7,
            function: "bash",
          })
        ),
        testToolEvent({
          uuid: "t",
          timestamp: iso(10),
          completed: iso(11),
          working_start: 10,
          working_time: 1,
        }),
      ],
      { axisMode: "turns" }
    );
    const { left, width } = plotBounds(container);
    const tools = [...container.querySelectorAll("rect[class*='toolSpan']")];
    expect(tools).toHaveLength(3);
    const lanes = tools.filter((t) => attr(t, "height") < kAgentSpanHeight);
    expect(lanes).toHaveLength(2);
    for (const lane of lanes) {
      expect(attr(lane, "x")).toBeCloseTo(left + width / 2);
      expect(attr(lane, "width")).toBeCloseTo(width / 4);
    }
    const single = tools.find((t) => attr(t, "height") === kAgentSpanHeight);
    expect(attr(single ?? null, "x")).toBeCloseTo(left + (3 * width) / 4);
    expect(attr(single ?? null, "width")).toBeCloseTo(width / 4);
  });

  it("gives a tool-only fallback turn the tool half and leaves the model half empty", () => {
    // A tool before any model call on its row opens a tool-only turn.
    const { container } = renderChart(
      [
        testToolEvent({
          uuid: "t",
          timestamp: iso(0),
          completed: iso(5),
          working_start: 0,
          working_time: 5,
        }),
        modelCall({ start: 10, end: 20, uuid: "m" }),
      ],
      { axisMode: "turns" }
    );
    const { left, width } = plotBounds(container);
    const colWidth = width / 2;
    const tool = container.querySelector("rect[class*='toolSpan']");
    expect(attr(tool, "x")).toBeCloseTo(left + colWidth / 2);
    expect(attr(tool, "width")).toBeCloseTo(colWidth / 2);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "x")).toBeCloseTo(left + colWidth);
    expect(attr(model, "width")).toBeCloseTo(colWidth / 2);
    expect(container.querySelectorAll("rect[class*='turnRect']")).toHaveLength(
      2
    );
  });

  it("stacks a burst of three as sub-lanes across the tool half", () => {
    const { container } = renderChart(
      [
        modelCall({ start: 0, end: 1, uuid: "m" }),
        ...Array.from({ length: 3 }, (_, i) =>
          testToolEvent({
            uuid: `t${i}`,
            timestamp: iso(2 + i * 0.1),
            completed: iso(10),
            working_start: 2,
            working_time: 7,
            function: "bash",
          })
        ),
      ],
      { axisMode: "turns" }
    );
    const { left, width } = plotBounds(container);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "width")).toBeCloseTo(width / 2);
    const lanes = [...container.querySelectorAll("rect[class*='toolSpan']")];
    expect(lanes).toHaveLength(3);
    const ys = new Set<number>();
    for (const lane of lanes) {
      expect(attr(lane, "x")).toBeCloseTo(left + width / 2);
      expect(attr(lane, "width")).toBeCloseTo(width / 2);
      expect(attr(lane, "height")).toBeLessThan(kAgentSpanHeight);
      ys.add(attr(lane, "y"));
    }
    expect(ys.size).toBe(3);
  });

  it("builds the token path left to right when calls overlap", () => {
    // Turn 1 runs [0,100] and completes AFTER turn 2 ([10,20]); the burn
    // steps must still climb column by column, never doubling back.
    const { container } = renderChart(
      [
        modelCall({ start: 0, end: 100, uuid: "m1" }),
        modelCall({ start: 10, end: 20, uuid: "m2" }),
      ],
      { axisMode: "turns" }
    );
    const d =
      container
        .querySelector("path[class*='tokenSeries']")
        ?.getAttribute("d") ?? "";
    const xs = pathXs(d);
    expect(xs.length).toBeGreaterThan(2);
    xs.forEach((x, i) => {
      if (i > 0) expect(x).toBeGreaterThanOrEqual(xs[i - 1]!);
    });
    // The first step lands on the first column's right edge.
    const { left, width } = plotBounds(container);
    expect(xs).toContain(left + width / 2);
  });

  it("lands pre-uuid curve points on their turn's right edge", () => {
    // Older logs have timestamps but no event uuids: the points still
    // belong to the turn that produced them.
    const { container } = renderChart(
      [modelCall({ start: 0, end: 10 }), modelCall({ start: 20, end: 30 })],
      { axisMode: "turns" }
    );
    const { left, right, width } = plotBounds(container);
    const dots = container.querySelectorAll("circle[class*='contextDot']");
    expect(attr(dots[0] ?? null, "cx")).toBe(left + width / 2);
    expect(attr(dots[1] ?? null, "cx")).toBe(right);
  });
});

describe("ActivityChart hidden conversations", () => {
  const fiveAgents = (): Event[] => {
    const events: Event[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(
        testSpanBeginEvent({
          id: `agent${i}`,
          name: `Agent ${i}`,
          type: "agent",
          timestamp: iso(i * 10),
        }),
        modelCall({
          start: i * 10,
          end: i * 10 + 5,
          uuid: `m${i}`,
          spanId: `agent${i}`,
        })
      );
    }
    return events;
  };

  it("keeps a persisted-hidden row out of the +N fold", () => {
    const { container } = renderChart(fiveAgents(), {
      hiddenAgentIds: ["agent4"],
    });
    // Four burn layers, four model spans: the folded fifth row stays hidden
    // even though the fold itself is collapsed.
    expect(
      container.querySelectorAll("path[class*='tokenLayerEdge']")
    ).toHaveLength(4);
    expect(container.querySelectorAll("rect[class*='modelSpan']")).toHaveLength(
      4
    );
    expect(screen.getByText(/4 of 5 shown/)).toBeTruthy();
  });

  it("keeps a persisted-hidden row out of the fold's turn columns", () => {
    const { container } = renderChart(fiveAgents(), {
      hiddenAgentIds: ["agent4"],
      axisMode: "turns",
    });
    expect(container.querySelectorAll("rect[class*='turnRect']")).toHaveLength(
      4
    );
  });
});

describe("ActivityChart tool bursts", () => {
  /** One model call, then six overlapping tools: four lanes plus a +2 fold. */
  const sixTools = (): Event[] => [
    modelCall({ start: 0, end: 1, uuid: "m" }),
    ...Array.from({ length: 6 }, (_, i) =>
      testToolEvent({
        uuid: `t${i}`,
        timestamp: iso(2 + i * 0.1),
        completed: iso(10),
        working_start: 2,
        working_time: 7,
        function: "bash",
      })
    ),
  ];

  it.each(["wall", "turns"] as const)(
    "renders only the capped lanes and the +N fold in %s mode",
    (axisMode) => {
      const { container } = renderChart(sixTools(), { axisMode });
      const tools = [...container.querySelectorAll("rect[class*='toolSpan']")];
      // Four thin lanes; the two overflow members render nothing of their
      // own (they used to paint full-height over the lanes).
      expect(tools).toHaveLength(4);
      for (const tool of tools) {
        expect(attr(tool, "height")).toBeLessThan(kAgentSpanHeight);
      }
      expect(
        container.querySelectorAll("rect[class*='modelSpan']")
      ).toHaveLength(1);
    }
  );

  it("labels the burst with its folded count", () => {
    renderChart(sixTools());
    expect(screen.getByText("bash ×6 · +2")).toBeTruthy();
  });

  it("restarts the tooltip dwell when the hovered lane changes", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart([
        modelCall({ start: 0, end: 1, uuid: "m" }),
        testToolEvent({
          uuid: "t1",
          function: "first",
          timestamp: iso(2),
          completed: iso(5),
        }),
        testToolEvent({
          uuid: "t2",
          function: "second",
          timestamp: iso(3),
          completed: iso(6),
        }),
      ]);
      const [a, b] = container.querySelectorAll("rect[class*='toolSpan']");
      if (!(a instanceof SVGElement) || !(b instanceof SVGElement))
        throw new Error("expected two burst lanes");
      // 100ms on one lane, then straight onto the other (pointer travel
      // inside the chart): the dwell restarts for the new lane.
      fireEvent.mouseEnter(a);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.mouseLeave(a, { relatedTarget: b });
      fireEvent.mouseEnter(b, { relatedTarget: a });
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(container.querySelector("[class*='tooltip']")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(80);
      });
      const hovered = container.querySelector("[class*='listRowHovered']");
      expect(hovered?.textContent).toContain("second");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the dwell between uuid-less lanes of the same call at the same start", () => {
    vi.useFakeTimers();
    try {
      // Pre-uuid logs: two `bash` calls start on the same second, so
      // start and label can't tell the lanes apart.
      const { container } = renderChart([
        modelCall({ start: 0, end: 1, uuid: "m" }),
        testToolEvent({
          function: "bash",
          timestamp: iso(2),
          completed: iso(5),
        }),
        testToolEvent({
          function: "bash",
          timestamp: iso(2),
          completed: iso(6),
        }),
      ]);
      const [a, b] = container.querySelectorAll("rect[class*='toolSpan']");
      if (!(a instanceof SVGElement) || !(b instanceof SVGElement))
        throw new Error("expected two burst lanes");
      fireEvent.mouseEnter(a);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.mouseLeave(a, { relatedTarget: b });
      fireEvent.mouseEnter(b, { relatedTarget: a });
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(container.querySelector("[class*='tooltip']")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(80);
      });
      // Lane B is the 4-second call; the card marks it, not lane A.
      const hovered = container.querySelectorAll("[class*='listRowHovered']");
      expect(hovered).toHaveLength(1);
      expect(hovered[0]?.textContent).toContain("4.0s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the dwell when a live completion re-sorts the burst lanes", () => {
    vi.useFakeTimers();
    try {
      // Two pending calls share a burst; when the second completes the
      // burst re-sorts and its lane index moves, so the lane the pointer
      // last dwelt on now holds a different call.
      const first = testToolEvent({
        id: "first-call",
        uuid: "first",
        function: "first",
        timestamp: iso(2),
        pending: true,
        completed: undefined,
      });
      const second = testToolEvent({
        id: "second-call",
        uuid: "second",
        function: "second",
        timestamp: iso(2),
        pending: true,
        completed: undefined,
      });
      const chartFor = (completed: boolean) => {
        const data = deriveActivityData({
          events: [
            modelCall({ start: 0, end: 1, uuid: "m" }),
            first,
            completed
              ? { ...second, pending: false, completed: iso(5) }
              : second,
          ],
          running: true,
          now: Date.parse(iso(10)) / 1000,
        });
        if (!data.window) throw new Error("expected a time window");
        return (
          <ActivityChart
            data={data}
            window={data.window}
            showWorking={false}
            showMarkers={false}
            showTokens
            showContext
            showModelTool
            selectedKey={null}
          />
        );
      };
      const { container, rerender } = render(chartFor(false));
      const lane = container.querySelector("rect[class*='toolSpan']");
      const hit = container.querySelector("rect[class*='plotHit']");
      if (!(lane instanceof SVGElement) || !(hit instanceof SVGElement))
        throw new Error("expected a lane and the plot");
      fireEvent.mouseEnter(lane);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(
        container.querySelector("[class*='listRowHovered']")?.textContent
      ).toContain("first");
      fireEvent.mouseLeave(lane, { relatedTarget: hit });
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(container.querySelector("[class*='tooltip']")).toBeNull();

      rerender(chartFor(true));
      const newLane = container.querySelector("rect[class*='toolSpan']");
      if (!(newLane instanceof SVGElement)) throw new Error("expected a lane");
      fireEvent.mouseEnter(newLane);
      // A different call under the pointer: no card until its own dwell.
      expect(container.querySelector("[class*='tooltip']")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(
        container.querySelector("[class*='listRowHovered']")?.textContent
      ).toContain("second");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the model half when a burst folds members in Turns mode", () => {
    // 1s of model work against 6 × 7s of tool work: the model still keeps
    // half the column, and the four drawn lanes share the other half.
    const { container } = renderChart(sixTools(), { axisMode: "turns" });
    const { left, width } = plotBounds(container);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "width")).toBeCloseTo(width / 2);
    for (const lane of container.querySelectorAll("rect[class*='toolSpan']")) {
      expect(attr(lane, "x")).toBeCloseTo(left + width / 2);
      expect(attr(lane, "width")).toBeCloseTo(width / 2);
    }
  });
});

describe("ActivityChart sub-second tool ticks", () => {
  // The teal tick's minimum visible width; Turns-mode column rects lose a
  // seam to their stroke on top of it.
  const kMinTickPx = 3;
  const kTurnSeamPx = 1.5;

  /** `n` turns of a 16 s model call and a 0.1 s tool — the real
   *  ascii-art log's shape, where a tool is ~0.2 px of wall clock and
   *  < 1 % of a Turns column. */
  const longModelShortTool = (n: number, tools = 1): Event[] =>
    Array.from({ length: n }, (_, i) => {
      const t0 = i * 16.1;
      return [
        modelCall({ start: t0, end: t0 + 16, uuid: `m${i}` }),
        ...Array.from({ length: tools }, (_, j) =>
          testToolEvent({
            uuid: `t${i}-${j}`,
            function: "python",
            timestamp: iso(t0 + 16),
            completed: iso(t0 + 16.1),
            working_start: t0 + 16,
            working_time: 0.1,
          })
        ),
      ];
    }).flat();

  it("floors the tool tick in Wall clock and paints it over the model span", () => {
    const { container } = renderChart(longModelShortTool(60));
    const tools = [...container.querySelectorAll("rect[class*='toolSpan']")];
    expect(tools).toHaveLength(60);
    for (const tool of tools) {
      expect(attr(tool, "width")).toBeGreaterThanOrEqual(kMinTickPx);
    }
    // A floored tick overlaps the next model span's start: it must be drawn
    // after every model span so it is not painted over.
    const rects = [
      ...container.querySelectorAll(
        "rect[class*='modelSpan'], rect[class*='toolSpan']"
      ),
    ];
    const kinds = rects.map((r) =>
      r.getAttribute("class")?.includes("toolSpan") ? "tool" : "model"
    );
    const lastModel = kinds.lastIndexOf("model");
    const firstTool = kinds.indexOf("tool");
    expect(firstTool).toBeGreaterThan(lastModel);
  });

  it("splits every Turns column equally between the long model call and the tick", () => {
    const { container } = renderChart(longModelShortTool(60), {
      axisMode: "turns",
    });
    const { width } = plotBounds(container);
    const colWidth = width / 60;
    const models = [...container.querySelectorAll("rect[class*='modelSpan']")];
    const tools = [...container.querySelectorAll("rect[class*='toolSpan']")];
    expect(tools).toHaveLength(60);
    models.forEach((model, i) => {
      const tool = tools[i]!;
      expect(attr(model, "width")).toBeCloseTo(colWidth / 2);
      expect(attr(tool, "width")).toBeCloseTo(colWidth / 2);
      expect(attr(tool, "width") - kTurnSeamPx).toBeGreaterThanOrEqual(
        kMinTickPx
      );
      expect(attr(tool, "x")).toBeCloseTo(
        attr(model, "x") + attr(model, "width")
      );
    });
  });

  it("slides a floored tick at the window's end back inside the plot", () => {
    const { container } = renderChart([
      modelCall({ start: 0, end: 999.9, uuid: "m" }),
      testToolEvent({
        uuid: "t",
        function: "python",
        timestamp: iso(999.9),
        completed: iso(1000),
        working_start: 999.9,
        working_time: 0.1,
      }),
    ]);
    const { right } = plotBounds(container);
    const tool = container.querySelector("rect[class*='toolSpan']");
    expect(attr(tool, "width")).toBeGreaterThanOrEqual(kMinTickPx);
    expect(attr(tool, "x") + attr(tool, "width")).toBeLessThanOrEqual(
      right + 1e-6
    );
  });

  it("gives a burst's sub-lanes the whole tool half of a Turns column", () => {
    const { container } = renderChart(longModelShortTool(60, 2), {
      axisMode: "turns",
    });
    const { width } = plotBounds(container);
    const colWidth = width / 60;
    const tools = [...container.querySelectorAll("rect[class*='toolSpan']")];
    expect(tools).toHaveLength(120);
    for (const tool of tools) {
      expect(attr(tool, "width")).toBeCloseTo(colWidth / 2);
    }
  });
});

// A Turns slot's legibility floor: the 3 px tick plus the 1.5 px seam.
const kSlotMinPx = 3 + 1.5;

/** `nTurns` one-second model calls 100 s apart; turn 1 also runs `tools`
 *  sequential one-second tool calls (the first `failed` of them erroring)
 *  — the shape that squeezes a dozen slots into a 5 px half at 91 turns. */
const sequentialTools = (
  nTurns: number,
  tools: number,
  failed = 0
): Event[] => [
  modelCall({ start: 0, end: 1, uuid: "m0" }),
  ...Array.from({ length: tools }, (_, i) =>
    testToolEvent({
      uuid: `t${i}`,
      function: "python",
      timestamp: iso(1 + i * 2),
      completed: iso(2 + i * 2),
      working_start: 1 + i * 2,
      working_time: 1,
      error: i < failed ? { type: "unknown", message: "boom" } : undefined,
    })
  ),
  ...Array.from({ length: nTurns - 1 }, (_, i) =>
    modelCall({
      start: (i + 1) * 100,
      end: (i + 1) * 100 + 1,
      uuid: `m${i + 1}`,
    })
  ),
];

/** `nTurns` one-second model calls 100 s apart; turn `at` also runs `tools`
 *  sequential one-second tool calls and has `rejected` calls turned down. */
const turnWith = (opts: {
  nTurns: number;
  at: number;
  tools?: number;
  rejected?: number;
}): Event[] => {
  const base = (opts.at - 1) * 100;
  return [
    ...Array.from({ length: opts.nTurns }, (_, i) =>
      modelCall({ start: i * 100, end: i * 100 + 1, uuid: `m${i}` })
    ),
    ...Array.from({ length: opts.tools ?? 0 }, (_, i) =>
      testToolEvent({
        uuid: `t${i}`,
        function: "python",
        timestamp: iso(base + 2 + i * 2),
        completed: iso(base + 3 + i * 2),
        working_start: base + 2 + i * 2,
        working_time: 1,
      })
    ),
    ...Array.from({ length: opts.rejected ?? 0 }, (_, i) =>
      testApprovalEvent({
        uuid: `r${i}`,
        timestamp: iso(base + 1.5 + i * 0.1),
        decision: "reject",
      })
    ),
  ];
};

const toolRects = (container: HTMLElement): Element[] =>
  [...container.querySelectorAll("rect[class*='toolSpan']")].sort(
    (a, b) => attr(a, "x") - attr(b, "x")
  );

const densityRects = (container: HTMLElement): Element[] => [
  ...container.querySelectorAll(
    "rect[class*='densityModel'], rect[class*='densityTool']"
  ),
];

describe("ActivityChart crowded Turns tool halves", () => {
  it("collapses twelve sequential tools in a 5 px half to one bounded aggregate rect", () => {
    const { container } = renderChart(sequentialTools(91, 12), {
      axisMode: "turns",
    });
    const { left, width } = plotBounds(container);
    const colWidth = width / 91;
    const tools = toolRects(container);
    expect(tools).toHaveLength(1);
    const aggregate = tools[0]!;
    expect(attr(aggregate, "x")).toBeCloseTo(left + colWidth / 2);
    expect(attr(aggregate, "width")).toBeCloseTo(colWidth / 2);
    expect(attr(aggregate, "width")).toBeGreaterThanOrEqual(3);
    expect(attr(aggregate, "x") + attr(aggregate, "width")).toBeLessThanOrEqual(
      left + colWidth + 1e-6
    );
    const models = [...container.querySelectorAll("rect[class*='modelSpan']")];
    expect(attr(models[0]!, "width")).toBeCloseTo(colWidth / 2);
    // The headline still counts every call the aggregate stands for.
    expect(screen.getByText(/12 tool calls/)).toBeTruthy();
  });

  it("reads the aggregate's call and failure counts on hover and outlines it", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(sequentialTools(91, 12, 1), {
        axisMode: "turns",
      });
      const aggregate = container.querySelector("rect[class*='toolSpan']");
      if (!(aggregate instanceof SVGElement))
        throw new Error("expected the aggregate tool rect");
      // One failed call among twelve keeps the teal fill and adds the
      // density strip's red failure hairline instead of the failed fill.
      expect(aggregate.getAttribute("class")).not.toContain("failedSpan");
      expect(
        container.querySelector("rect[class*='densityFailure']")
      ).not.toBeNull();
      fireEvent.mouseEnter(aggregate);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(aggregate.getAttribute("class")).toContain("spanHovered");
      const card = container.querySelector("[class*='tooltip']");
      expect(card?.textContent).toContain("turn 1 · 12 tool calls · 1 failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses four sequential tools at the 91-turn width too", () => {
    const { container } = renderChart(sequentialTools(91, 4), {
      axisMode: "turns",
    });
    const { width } = plotBounds(container);
    // Four slots need 18 px of floor + seam; the half has ~5.3 px.
    expect(4 * kSlotMinPx).toBeGreaterThan(width / 91 / 2);
    expect(toolRects(container)).toHaveLength(1);
  });

  it("keeps the ghost encoding when a crowded turn's calls were all rejected", () => {
    vi.useFakeTimers();
    try {
      // Two rejected calls and no tool run at the 91-turn width: two ghost
      // slots need 9 px, the half has ~5.3.
      const { container } = renderChart(
        turnWith({ nTurns: 91, at: 1, rejected: 2 }),
        { axisMode: "turns" }
      );
      const { left, width } = plotBounds(container);
      const colWidth = width / 91;
      expect(toolRects(container)).toHaveLength(0);
      const ghosts = [
        ...container.querySelectorAll("rect[class*='ghostSpan']"),
      ];
      expect(ghosts).toHaveLength(1);
      const ghost = ghosts[0]!;
      if (!(ghost instanceof SVGElement)) throw new Error("expected a rect");
      expect(ghost.getAttribute("class")).toContain("ghostAggregate");
      expect(ghost.getAttribute("class")).not.toContain("toolSpan");
      // Inside the tool half, inset for its own dashed stroke.
      expect(attr(ghost, "x")).toBeGreaterThanOrEqual(left + colWidth / 2);
      expect(attr(ghost, "x") + attr(ghost, "width")).toBeLessThanOrEqual(
        left + colWidth + 1e-6
      );
      expect(attr(ghost, "width")).toBeGreaterThanOrEqual(3);
      expect(screen.getByText(/2 rejected/)).toBeTruthy();
      expect(screen.queryByText(/×/)).toBeNull();
      fireEvent.mouseEnter(ghost);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(ghost.getAttribute("class")).toContain("spanHovered");
      const card = container.querySelector("[class*='tooltip']");
      expect(card?.textContent).toContain("turn 1 · 2 rejected · no tool run");
      expect(card?.textContent).not.toContain("0 tool");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a wide rejected-only aggregate no count label at all", () => {
    // Six rejections in turn 10 of 20: the 24 px half is crowded (27 px of
    // slot floors) and has room for a `×N` — which would read `×0`.
    const { container } = renderChart(
      turnWith({ nTurns: 20, at: 10, rejected: 6 }),
      { axisMode: "turns" }
    );
    expect(toolRects(container)).toHaveLength(0);
    expect(
      container.querySelectorAll("rect[class*='ghostAggregate']")
    ).toHaveLength(1);
    expect(screen.queryByText(/×/)).toBeNull();
    expect(screen.getByText(/6 rejected/)).toBeTruthy();
  });

  it("keeps teal and the executed count for a mixed crowded turn", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(
        turnWith({ nTurns: 20, at: 10, tools: 8, rejected: 2 }),
        { axisMode: "turns" }
      );
      const tools = toolRects(container);
      expect(tools).toHaveLength(1);
      expect(
        container.querySelectorAll("rect[class*='ghostSpan']")
      ).toHaveLength(0);
      // The label counts the eight executed calls, not the ten slots.
      expect(screen.getByText("×8")).toBeTruthy();
      fireEvent.mouseEnter(tools[0]!);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      const card = container.querySelector("[class*='tooltip']");
      expect(card?.textContent).toContain(
        "turn 10 · 8 tool calls · 2 rejected"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps individual, contiguous, non-overlapping rects while the slots fit", () => {
    const { container } = renderChart(sequentialTools(10, 4), {
      axisMode: "turns",
    });
    const { left, width } = plotBounds(container);
    const colWidth = width / 10;
    const tools = toolRects(container);
    expect(tools).toHaveLength(4);
    expect(attr(tools[0]!, "x")).toBeCloseTo(left + colWidth / 2);
    tools.forEach((tool, i) => {
      expect(attr(tool, "width")).toBeGreaterThanOrEqual(kSlotMinPx);
      expect(attr(tool, "width")).toBeCloseTo(colWidth / 8);
      const next = tools[i + 1];
      if (next) {
        expect(attr(next, "x")).toBeCloseTo(
          attr(tool, "x") + attr(tool, "width")
        );
      }
    });
    const last = tools[3]!;
    expect(attr(last, "x") + attr(last, "width")).toBeCloseTo(left + colWidth);
    expect(container.querySelector("[class*='densityFailure']")).toBeNull();
  });
});

describe("ActivityChart click actions", () => {
  // Charles, 2026-09-16: the hover card's footer link is the chart's only
  // navigation. Nothing drawn in the plot carries a click action any more —
  // not spans, not the density strip, not the crowded-half aggregate, not
  // marker glyphs — and nothing promises one with a pointer cursor.
  const twoTurnsWithTool = (): Event[] => [
    modelCall({ start: 0, end: 10, uuid: "m1" }),
    testToolEvent({
      uuid: "t1",
      function: "bash",
      timestamp: iso(10),
      completed: iso(12),
      working_start: 10,
      working_time: 2,
      error: { type: "unknown", message: "exit 127" },
    }),
    modelCall({ start: 20, end: 30, uuid: "m2" }),
  ];
  const clickEvery = (container: HTMLElement, selector: string): number => {
    const targets = [...container.querySelectorAll(selector)];
    for (const target of targets) fireEvent.click(target);
    return targets.length;
  };
  const noPointerCursor = (container: HTMLElement) => {
    for (const el of container.querySelectorAll("rect")) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/clickable/i);
    }
  };

  it("does not navigate when a Wall clock span is clicked", () => {
    const onOpenEvent = vi.fn();
    const { container } = renderChart(twoTurnsWithTool(), { onOpenEvent });
    expect(
      clickEvery(container, "rect[class*='modelSpan'], rect[class*='toolSpan']")
    ).toBe(3);
    expect(onOpenEvent).not.toHaveBeenCalled();
    noPointerCursor(container);
  });

  it("does not navigate when a Turns column rect is clicked", () => {
    const onOpenEvent = vi.fn();
    const { container } = renderChart(twoTurnsWithTool(), {
      axisMode: "turns",
      onOpenEvent,
    });
    expect(clickEvery(container, "rect[class*='turnRect']")).toBe(3);
    expect(onOpenEvent).not.toHaveBeenCalled();
    noPointerCursor(container);
  });

  it("leaves the crowded-half aggregate and the density strip inert", () => {
    const onOpenEvent = vi.fn();
    const crowded = renderChart(sequentialTools(91, 12), {
      axisMode: "turns",
      onOpenEvent,
    });
    expect(clickEvery(crowded.container, "rect[class*='toolSpan']")).toBe(1);
    noPointerCursor(crowded.container);
    cleanup();
    const dense = renderChart(sequentialTools(320, 4), {
      axisMode: "turns",
      onOpenEvent,
    });
    expect(densityRects(dense.container).length).toBeGreaterThan(0);
    clickEvery(
      dense.container,
      "rect[class*='density'], rect[class*='plotHit']"
    );
    expect(onOpenEvent).not.toHaveBeenCalled();
    noPointerCursor(dense.container);
  });

  it("shows a marker's card on focus without selecting or navigating", () => {
    vi.useFakeTimers();
    try {
      const onOpenEvent = vi.fn();
      renderChart(twoTurnsWithTool(), { showMarkers: true, onOpenEvent });
      const glyph = screen.getByRole("button", { name: /Tool bash errored/ });
      fireEvent.click(glyph);
      fireEvent.keyDown(glyph, { key: "Enter" });
      expect(onOpenEvent).not.toHaveBeenCalled();
      fireEvent.focus(glyph);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      fireEvent.click(
        screen.getByRole("button", { name: "open in transcript →" })
      );
      expect(onOpenEvent).toHaveBeenCalledWith("t1", expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it("navigates only through the hovered span's card footer", () => {
    vi.useFakeTimers();
    try {
      const onOpenEvent = vi.fn();
      const { container } = renderChart(twoTurnsWithTool(), { onOpenEvent });
      const tool = container.querySelector("rect[class*='toolSpan']");
      if (!(tool instanceof SVGElement)) throw new Error("expected the tool");
      fireEvent.mouseEnter(tool);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      fireEvent.click(tool);
      expect(onOpenEvent).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "open in transcript →" })
      );
      expect(onOpenEvent).toHaveBeenCalledWith("t1", expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ActivityChart narrow Turns columns", () => {
  // The stubbed chart is 1000 px wide → a 960 px plot, the reviewer's
  // geometry: the global 3 px-per-turn density threshold sits at 320 turns
  // and the 9 px column that gives each half its 4.5 px floor at 106.

  it("degrades a row to the strip at the global density boundary instead of a seam-covered half", () => {
    // 320 turns: `turnsDense` is false at equality, the tool half would be
    // 1.5 px — all seam stroke, no teal.
    const { container } = renderChart(sequentialTools(320, 4), {
      axisMode: "turns",
    });
    const { width } = plotBounds(container);
    expect(width / 320).toBeCloseTo(3);
    expect(toolRects(container)).toHaveLength(0);
    expect(container.querySelectorAll("rect[class*='turnRect']")).toHaveLength(
      0
    );
    expect(densityRects(container).length).toBeGreaterThan(0);
    expect(screen.getByText(/per-pixel occupancy/)).toBeTruthy();
  });

  it("degrades at 300 turns, where the aggregate would keep ~0.1 px of teal", () => {
    const { container } = renderChart(sequentialTools(300, 4), {
      axisMode: "turns",
    });
    expect(toolRects(container)).toHaveLength(0);
    expect(densityRects(container).length).toBeGreaterThan(0);
  });

  it("degrades a single narrow slot the same way (200 turns, one tool)", () => {
    const { container } = renderChart(sequentialTools(200, 1), {
      axisMode: "turns",
    });
    expect(toolRects(container)).toHaveLength(0);
    expect(densityRects(container).length).toBeGreaterThan(0);
    expect(screen.getByText(/per-pixel occupancy/)).toBeTruthy();
  });

  it("switches exactly where a half drops under the tick floor plus seam", () => {
    const legible = renderChart(sequentialTools(106, 1), { axisMode: "turns" });
    const { width } = plotBounds(legible.container);
    expect(width / 106 / 2).toBeGreaterThanOrEqual(kSlotMinPx);
    const tools = toolRects(legible.container);
    expect(tools).toHaveLength(1);
    expect(attr(tools[0]!, "width")).toBeCloseTo(width / 106 / 2);
    expect(densityRects(legible.container)).toHaveLength(0);
    cleanup();
    const dense = renderChart(sequentialTools(107, 1), { axisMode: "turns" });
    expect(width / 107 / 2).toBeLessThan(kSlotMinPx);
    expect(toolRects(dense.container)).toHaveLength(0);
    expect(densityRects(dense.container).length).toBeGreaterThan(0);
  });

  it("degrades a model-only row at the same column width: its rects are halves too", () => {
    // The strict grid gives a tool-less turn a half-column model rect, so
    // a model-only row loses legibility at the same 9 px column as any
    // other and no longer keeps full columns down to the global threshold.
    const { container } = renderChart(sequentialTools(200, 0), {
      axisMode: "turns",
    });
    expect(container.querySelectorAll("rect[class*='turnRect']")).toHaveLength(
      0
    );
    expect(densityRects(container).length).toBeGreaterThan(0);
    expect(screen.getByText(/per-pixel occupancy/)).toBeTruthy();
    cleanup();
    const legible = renderChart(sequentialTools(106, 0), { axisMode: "turns" });
    expect(
      legible.container.querySelectorAll("rect[class*='turnRect']")
    ).toHaveLength(106);
    expect(densityRects(legible.container)).toHaveLength(0);
  });

  it("never draws a tool rect narrower than the floor plus seam at any turn count", () => {
    for (const [nTurns, tools] of [
      [50, 1],
      [91, 12],
      [106, 4],
      [107, 4],
      [150, 1],
      [200, 2],
      [300, 4],
      [320, 4],
    ] as const) {
      const { container } = renderChart(sequentialTools(nTurns, tools), {
        axisMode: "turns",
      });
      const rects = toolRects(container);
      if (rects.length === 0) {
        expect(densityRects(container).length).toBeGreaterThan(0);
      } else {
        for (const rect of rects) {
          expect(attr(rect, "width")).toBeGreaterThanOrEqual(kSlotMinPx - 1e-6);
        }
      }
      cleanup();
    }
  });
});

describe("ActivityChart tool colour", () => {
  // The module css is not loaded under jsdom, so the token is checked at
  // its source: one variable on the chart root, redefined for dark theme.
  const css = readFileSync(join(__dirname, "ActivityChart.module.css"), "utf8");
  const declared = (block: RegExp, name: string): string => {
    const match = block
      .exec(css)?.[1]
      ?.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`));
    if (!match?.[1]) throw new Error(`expected ${name} in ${block}`);
    return match[1];
  };
  const light = /^\.chart \{([^}]*)\}/m;
  const dark = /^:global\(\[data-bs-theme="dark"\]\) \.chart \{([^}]*)\}/m;
  const channel = (hex: string, at: number): number => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string): number =>
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5);
  const contrast = (a: string, b: string): number => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  it("fills tool rects from the tool colour token in both axis modes", () => {
    for (const axisMode of ["wall", "turns"] as const) {
      const { container } = renderChart(
        [
          modelCall({ start: 0, end: 10, uuid: "m" }),
          testToolEvent({
            uuid: "t",
            timestamp: iso(10),
            completed: iso(20),
            working_start: 10,
            working_time: 10,
          }),
        ],
        { axisMode }
      );
      const tool = container.querySelector("rect[class*='toolSpan']");
      expect(tool).not.toBeNull();
      cleanup();
    }
    expect(css).toMatch(/\.toolSpan \{\s*fill: var\(--sa-tool-color\);/);
    expect(css).toMatch(/\.modelSpan \{\s*fill: var\(--sa-model-color\);/);
    expect(css).toMatch(
      /\.burstLabel \{\s*[^}]*fill: var\(--sa-tool-label-color\);/
    );
  });

  it("keeps the tool colour clearly apart from the model grey in light and dark", () => {
    const grey = declared(light, "--sa-model-color");
    const lightTool = declared(light, "--sa-tool-color");
    const darkTool = declared(dark, "--sa-tool-color");
    // The round-6 teal (#4f8f8b) sat at 1.28 : 1 against the grey.
    expect(contrast(lightTool, grey)).toBeGreaterThanOrEqual(1.8);
    expect(contrast(darkTool, grey)).toBeGreaterThanOrEqual(2.4);
    // Visible as a fill on each theme's page background.
    expect(contrast(lightTool, "#ffffff")).toBeGreaterThanOrEqual(2.4);
    expect(contrast(darkTool, "#212529")).toBeGreaterThanOrEqual(6);
  });
});

describe("ActivityChart span hover", () => {
  const css = readFileSync(join(__dirname, "ActivityChart.module.css"), "utf8");

  it.each(["wall", "turns"] as const)(
    "outlines only the hovered span in %s mode: its turn-mate keeps full opacity",
    (axisMode) => {
      const { container } = renderChart(
        [
          modelCall({ start: 0, end: 10, uuid: "m" }),
          testToolEvent({
            uuid: "t",
            timestamp: iso(10),
            completed: iso(12),
            working_start: 10,
            working_time: 2,
          }),
        ],
        { axisMode }
      );
      const tool = container.querySelector("rect[class*='toolSpan']");
      const model = container.querySelector("rect[class*='modelSpan']");
      if (!(tool instanceof SVGElement) || !(model instanceof SVGElement))
        throw new Error("expected a model and a tool span");
      fireEvent.mouseEnter(tool);
      expect(tool.getAttribute("class")).toContain("spanHovered");
      // The model call before the tool shares its turn. Handoff 11a dimmed
      // it to 0.6; the design owner dropped that (2026-09-15).
      expect(model.getAttribute("class")).not.toContain("spanHovered");
      expect(model.getAttribute("class")).not.toMatch(/dim/i);
      expect(model.getAttribute("opacity")).toBeNull();
      expect(model.getAttribute("style") ?? "").not.toContain("opacity");
    }
  );

  it("declares no turn-mate dim rule", () => {
    expect(css).toMatch(/\.spanHovered \{/);
    expect(css).not.toMatch(/spanDim/);
  });
});

describe("ActivityChart Turns gridlines", () => {
  const nTurns = (n: number): Event[] =>
    Array.from({ length: n }, (_, i) =>
      modelCall({ start: i * 2, end: i * 2 + 1, uuid: `m${i}` })
    );
  const separators = (container: HTMLElement) =>
    container.querySelectorAll("line[class*='turnSeparator']");
  const tickLabels = (container: HTMLElement) =>
    container.querySelectorAll(
      "text[class*='axisLabel'][text-anchor='middle']"
    );

  // 11 and 22–24 turns fell to 5 and 4 separators under the 1-2-5 steps;
  // 55–65 is the 5 → 10 gap the added steps close.
  it.each([11, 22, 24, 55, 65, 91, 1000])(
    "draws 6–10 separators and a label per separator plus turn 1 for %i turns",
    (n) => {
      const { container } = renderChart(nTurns(n), { axisMode: "turns" });
      const seps = separators(container);
      expect(seps.length).toBeGreaterThanOrEqual(6);
      expect(seps.length).toBeLessThanOrEqual(10);
      expect(seps.length).toBe(turnGridSeparators(n, turnGridStep(n)));
      expect(tickLabels(container)).toHaveLength(seps.length + 1);
    },
    20000
  );

  it("stays within 6–10 separators for every turn count from 7 to 1,200", () => {
    for (let n = 7; n <= 1200; n++) {
      const count = turnGridSeparators(n, turnGridStep(n));
      expect(count, `${n} turns`).toBeGreaterThanOrEqual(6);
      expect(count, `${n} turns`).toBeLessThanOrEqual(10);
    }
    // Below seven columns there are fewer than six boundaries to draw.
    for (let n = 2; n <= 6; n++) {
      expect(turnGridStep(n)).toBe(1);
      expect(turnGridSeparators(n, 1)).toBe(n - 1);
    }
  });

  it("keeps one separator per column boundary for a handful of turns", () => {
    const { container } = renderChart(nTurns(5), { axisMode: "turns" });
    expect(separators(container)).toHaveLength(4);
    const labels = [...tickLabels(container)].map((l) => l.textContent);
    expect(labels).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("ActivityChart corrupt telemetry", () => {
  it("keeps token and context geometry finite when usage overflows", () => {
    // 1e308 + 1e308 = Infinity: without a bound the token path's d
    // attribute reads "NaN" and the curve vanishes.
    const { container } = renderChart(
      normalizeEvents([
        modelCall({ start: 0, end: 1, uuid: "a", input: 1e308 }),
        modelCall({ start: 2, end: 3, uuid: "b", input: 1e308 }),
        modelCall({ start: 4, end: 5, uuid: "c", input: 100 }),
      ])
    );
    const d = container
      .querySelector("path[class*='tokenSeries']")
      ?.getAttribute("d");
    expect(d).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});

describe("ActivityChart folded conversations at scale", () => {
  const manyAgents = (n: number): Event[] =>
    Array.from({ length: n }, (_, i) => [
      testSpanBeginEvent({
        id: `a${i}`,
        name: `a${i}`,
        type: "agent",
        timestamp: iso(i),
      }),
      modelCall({ start: i, end: i + 1, uuid: `m${i}`, spanId: `a${i}` }),
    ]).flat();

  it("draws the collapsed fold as one layer and one legend entry", () => {
    const { container } = renderChart(manyAgents(1000));
    // Four real rows plus the +996 fold — in the gutter, the burn layers
    // and the legend alike; the svg stays a few hundred px tall.
    expect(container.querySelectorAll("rect[role='checkbox']")).toHaveLength(4);
    expect(
      container.querySelectorAll("path[class*='tokenLayerEdge']")
    ).toHaveLength(5);
    expect(attr(container.querySelector("svg"), "height")).toBeLessThan(600);
    expect(screen.getAllByText("+996 more").length).toBeGreaterThanOrEqual(3);
    // The gutter legend is swatch + name only (design owner 2026-09-15):
    // five names per curve band, no per-row values next to the y ticks.
    const legendNames = () =>
      [...container.querySelectorAll("text[class*='legendName']")].map(
        (el) => el.textContent
      );
    expect(legendNames()).toHaveLength(10);
    expect(legendNames().filter((n) => n === "+996 more")).toHaveLength(2);
    expect(container.querySelector("text[class*='legendValue']")).toBeNull();

    // A cursor at the right edge draws the read-out dots and the hover
    // card; the legend stays as it was, with no AT CURSOR caption.
    const { right } = plotBounds(container);
    const hit = container.querySelector("rect[class*='plotHit']");
    if (!(hit instanceof SVGElement)) throw new Error("expected plot hit");
    fireEvent.mouseMove(hit, { clientX: right, clientY: 50 });
    expect(legendNames()).toHaveLength(10);
    expect(screen.queryByText("AT CURSOR")).toBeNull();
    expect(container.querySelector("text[class*='legendValue']")).toBeNull();
  }, 20000);

  // The two folded conversations hold 100 and 300 tokens of context, so a
  // sum (400) and a maximum (300) are told apart.
  const sixWithContext = (): Event[] =>
    Array.from({ length: 6 }, (_, i) => [
      testSpanBeginEvent({
        id: `a${i}`,
        name: `a${i}`,
        type: "agent",
        timestamp: iso(i),
      }),
      modelCall({
        start: i,
        end: i + 1,
        uuid: `m${i}`,
        spanId: `a${i}`,
        input: i === 5 ? 300 : 100,
      }),
    ]).flat();

  const hoverContextEdge = (container: HTMLElement) => {
    const { right } = plotBounds(container);
    const contextLabel = [
      ...container.querySelectorAll("text[class*='bandLabel']"),
    ].find((label) => label.textContent === "CONTEXT SIZE");
    const hit = container.querySelector("rect[class*='plotHit']");
    if (!(hit instanceof SVGElement)) throw new Error("expected plot hit");
    fireEvent.mouseMove(hit, {
      clientX: right,
      clientY: attr(contextLabel ?? null, "y") + 30,
    });
  };

  it("captions the fold's context on the hover card as its largest member's", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(sixWithContext());
      hoverContextEdge(container);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      const card = container.querySelector("[class*='tooltip']")?.textContent;
      expect(card).toContain("+2 more");
      expect(card).toContain("max 300");
      expect(card).not.toContain("400");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the max label when the fold is the only visible context row", () => {
    vi.useFakeTimers();
    try {
      // Hiding the four leading conversations leaves the fold alone, so
      // the card takes its single-value form.
      const { container } = renderChart(sixWithContext(), {
        hiddenAgentIds: ["a0", "a1", "a2", "a3"],
      });
      hoverContextEdge(container);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      const card = container.querySelector("[class*='tooltip']")?.textContent;
      expect(card).toContain("max 300");
      expect(card).toContain("tokens in context");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists the folded members' names on the aggregate curve card", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(manyAgents(6));
      const { left, width } = plotBounds(container);
      const tokensLabel = [
        ...container.querySelectorAll("text[class*='bandLabel']"),
      ].find((label) => label.textContent === "TOKEN BURN");
      const hit = container.querySelector("rect[class*='plotHit']");
      if (!(hit instanceof SVGElement)) throw new Error("expected plot hit");
      fireEvent.mouseMove(hit, {
        clientX: left + width,
        clientY: attr(tokensLabel ?? null, "y") + 30,
      });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      const card = container.querySelector("[class*='tooltip']")?.textContent;
      expect(card).toContain("+2 more");
      expect(card).toContain("200");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ActivityChart fold row identity", () => {
  const conversation = (id: string, i: number): Event[] => [
    testSpanBeginEvent({ id, name: id, type: "agent", timestamp: iso(i) }),
    modelCall({ start: i, end: i + 1, uuid: `m-${id}`, spanId: id }),
  ];

  it("folds a log-authored __fold__ conversation as an ordinary member", () => {
    const { container } = renderChart([
      ...[0, 1, 2, 3].flatMap((i) => conversation(`a${i}`, i)),
      ...conversation("__fold__", 4),
    ]);
    // Four real rows plus the +1 fold whose one member is the fifth
    // conversation: its curves draw as the fold's, once.
    expect(container.querySelectorAll("rect[role='checkbox']")).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: /^Show 1 more rows/ })
    ).toBeTruthy();
    expect(
      container.querySelectorAll("path[class*='tokenLayerEdge']")
    ).toHaveLength(5);
    expect(
      container.querySelectorAll("polyline[class*='contextSeries']")
    ).toHaveLength(5);
  });

  it("keeps the curves of a lone __fold__ conversation", () => {
    const { container } = renderChart(conversation("__fold__", 0));
    expect(
      container.querySelectorAll("polyline[class*='contextSeries']")
    ).toHaveLength(1);
    expect(
      container.querySelector("path[class*='tokenSeries']")
    ).not.toBeNull();
  });
});

describe("ActivityChart curve read-outs", () => {
  /** Hover the context band at `clientX` and open the curve card. */
  const hoverContext = (container: HTMLElement, clientX: number) => {
    const hit = container.querySelector("rect[class*='plotHit']");
    if (!(hit instanceof SVGElement)) throw new Error("expected plot hit");
    const contextLabel = [
      ...container.querySelectorAll("text[class*='bandLabel']"),
    ].find((label) => label.textContent === "CONTEXT SIZE");
    fireEvent.mouseMove(hit, {
      clientX,
      clientY: attr(contextLabel ?? null, "y") + 30,
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    return container.querySelector("[class*='tooltip']")?.textContent ?? "";
  };

  it.each(["wall", "turns"] as const)(
    "reads the compacted size after a trailing compaction in %s mode",
    (axisMode) => {
      vi.useFakeTimers();
      try {
        // Context 100 at t=0, compaction 100→20 at t=5 and nothing but a
        // stray span end after it: hovering past the cliff reads 20. The
        // Turns axis has no column after the last turn, so the drop sits
        // on the plot's right edge and the read-out there holds it.
        const { container } = renderChart(
          [
            modelCall({ start: 0, end: 1, uuid: "m", input: 100 }),
            testCompactionEvent({
              timestamp: iso(5),
              tokens_before: 100,
              tokens_after: 20,
            }),
            testSpanEndEvent({ id: "unmatched", timestamp: iso(10) }),
          ],
          { axisMode }
        );
        const { left, right, width } = plotBounds(container);
        const text = hoverContext(
          container,
          axisMode === "wall" ? left + width * 0.8 : right
        );
        expect(text).toContain("20 tokens in context");
        expect(text).not.toContain("100 tokens in context");
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it("reads the context line at the cursor, interpolating between points", () => {
    vi.useFakeTimers();
    try {
      // Context 100 at t=0 and 300 at t=10 over a 20s window: the cursor at
      // t=5 (a quarter of the plot) reads 200 on the drawn line, and the
      // dot sits on it.
      const { container } = renderChart([
        modelCall({ start: 0, end: 5, uuid: "m1", input: 100 }),
        modelCall({ start: 10, end: 20, uuid: "m2", input: 300 }),
      ]);
      const line = container.querySelector("polyline[class*='contextSeries']");
      const ys = (line?.getAttribute("points") ?? "")
        .split(" ")
        .map((p) => Number(p.split(",")[1]));
      const hit = container.querySelector("rect[class*='plotHit']");
      if (!(hit instanceof SVGElement)) throw new Error("expected plot hit");
      // Pointer inside the context band: its label sits 14px below the
      // band top, so 30px under the label is well within the plot.
      const contextLabel = [
        ...container.querySelectorAll("text[class*='bandLabel']"),
      ].find((label) => label.textContent === "CONTEXT SIZE");
      const { left, width } = plotBounds(container);
      fireEvent.mouseMove(hit, {
        clientX: left + width / 4,
        clientY: attr(contextLabel ?? null, "y") + 30,
      });
      const dot = container.querySelector("circle[class*='readoutDot']");
      expect(attr(dot, "cy")).toBeCloseTo((ys[0]! + ys[1]!) / 2, 1);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(
        container.querySelector("[class*='tooltip']")?.textContent
      ).toContain("200 tokens in context");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ActivityChart tooltip travel", () => {
  // Two turns with context so the context band draws under the activity
  // band; the second span sits mid-plot, clear of the plot's left edge.
  const twoTurns = (): Event[] => [
    modelCall({ start: 0, end: 10, uuid: "m1", input: 100 }),
    modelCall({ start: 20, end: 30, uuid: "m2", input: 200 }),
  ];
  const plotHit = (container: HTMLElement): SVGElement => {
    const hit = container.querySelector("rect[class*='plotHit']");
    if (!(hit instanceof SVGElement)) throw new Error("expected plot hit");
    return hit;
  };
  /** A y inside the context band's plot (its label sits 14px below the
   *  band top). */
  const contextBandY = (container: HTMLElement): number => {
    const label = [
      ...container.querySelectorAll("text[class*='bandLabel']"),
    ].find((l) => l.textContent === "CONTEXT SIZE");
    return attr(label ?? null, "y") + 30;
  };
  const card = (container: HTMLElement): HTMLElement | null => {
    const el = container.querySelector("[class*='tooltip']");
    return el instanceof HTMLElement ? el : null;
  };
  const cardLeft = (container: HTMLElement): number =>
    parseFloat(card(container)?.style.left ?? "NaN");
  /** Leave `span` for the empty plot — a real pointer always goes
   *  somewhere, and the chart's own leave handler must not fire. */
  const leaveSpan = (span: SVGElement, hit: SVGElement) => {
    fireEvent.mouseLeave(span, { relatedTarget: hit });
  };
  /** Hover the second model span and wait out the show delay. */
  const showSecondCard = (container: HTMLElement): SVGElement => {
    const span = container.querySelectorAll("rect[class*='modelSpan']")[1];
    if (!(span instanceof SVGElement)) throw new Error("expected two spans");
    fireEvent.mouseEnter(span);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(card(container)?.textContent).toContain("Model turn 2");
    return span;
  };

  it("holds the span card while the pointer closes in on it across the context band", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(twoTurns());
      const span = showSecondCard(container);
      const left = cardLeft(container);
      const hit = plotHit(container);
      const y = contextBandY(container);
      leaveSpan(span, hit);
      // Six moves 200 ms apart just left of the card, each a little
      // nearer: 1.2 s in all, four times the grace, and never a curve
      // read-out in place of the span card.
      for (let i = 1; i <= 6; i++) {
        fireEvent.mouseMove(hit, {
          clientX: left - 22 + 3 * i,
          clientY: y + i,
        });
        act(() => {
          vi.advanceTimersByTime(200);
        });
        expect(card(container)?.textContent ?? "", `move ${i}`).toContain(
          "Model turn 2"
        );
      }
      // The card waited where it was rather than chasing the pointer.
      expect(cardLeft(container)).toBe(left);
      // Resting beside it runs the grace out; the next move over the band
      // is an ordinary curve hover again.
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(card(container)).toBeNull();
      fireEvent.mouseMove(hit, { clientX: left - 4, clientY: y + 6 });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(card(container)?.textContent).toContain("tokens in context");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the grace run out on a pointer that drifts away inside the card's column", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(twoTurns());
      const span = showSecondCard(container);
      const left = cardLeft(container);
      const hit = plotHit(container);
      const y = contextBandY(container);
      leaveSpan(span, hit);
      // Still within the column, but each move a little further from the
      // card: no curve read-out yet, and no fresh grace either.
      for (let i = 1; i <= 3; i++) {
        fireEvent.mouseMove(hit, { clientX: left - 2 - 7 * i, clientY: y });
        act(() => {
          vi.advanceTimersByTime(80);
        });
        expect(card(container)?.textContent ?? "", `move ${i}`).toContain(
          "Model turn 2"
        );
      }
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(card(container)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the curve at once when the pointer leaves the card's column", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(twoTurns());
      const span = showSecondCard(container);
      const left = cardLeft(container);
      const hit = plotHit(container);
      leaveSpan(span, hit);
      fireEvent.mouseMove(hit, {
        clientX: left - 60,
        clientY: contextBandY(container),
      });
      expect(card(container)).toBeNull();
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(card(container)?.textContent).toContain("tokens in context");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops following the pointer horizontally once it leaves the span", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(twoTurns());
      const span = showSecondCard(container);
      const svg = container.querySelector("svg");
      if (!svg) throw new Error("expected the chart svg");
      const spanX = attr(span, "x");
      const spanY = attr(span, "y");
      // Over the span the card follows the pointer (handoff 11b)...
      fireEvent.mouseMove(svg, { clientX: spanX + 30, clientY: spanY + 5 });
      expect(cardLeft(container)).toBe(spanX + 30 + 12);
      // ...and holds still once the pointer has left it for the empty plot.
      const hit = plotHit(container);
      leaveSpan(span, hit);
      fireEvent.mouseMove(hit, {
        clientX: spanX + 60,
        clientY: spanY + 20,
      });
      expect(card(container)?.textContent ?? "").toContain("Model turn 2");
      expect(cardLeft(container)).toBe(spanX + 30 + 12);
    } finally {
      vi.useRealTimers();
    }
  });
});
