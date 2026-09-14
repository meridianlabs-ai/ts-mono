// @vitest-environment jsdom
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
  testCompactionEvent,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSpanBeginEvent,
  testSpanEndEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { Event, ModelEvent } from "@tsmono/inspect-common/types";

import { ActivityChart, ActivityChartProps } from "./ActivityChart";
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
      onSelectMarker={() => {}}
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
  it("splits a column by working time, not wall time", () => {
    // 10s of model work, then a tool that waited 80s of its 90s wall span:
    // 10s model : 10s tool → an even split of the 960px column.
    const { container } = renderChart(
      [
        modelCall({ start: 0, end: 10, uuid: "m" }),
        testToolEvent({
          uuid: "t",
          timestamp: iso(10),
          completed: iso(100),
          working_start: 10,
          working_time: 10,
        }),
      ],
      { axisMode: "turns" }
    );
    const { left, width } = plotBounds(container);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "width")).toBeCloseTo(width / 2);
    const tool = container.querySelector("rect[class*='toolSpan']");
    expect(attr(tool, "x")).toBeCloseTo(left + width / 2);
    expect(attr(tool, "width")).toBeCloseTo(width / 2);
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

  it("counts a burst's working weight once in the Turns split", () => {
    // 1s of model work against 6 × 7s of tool work: the model share is
    // 1/43 of the column whether or not two members are folded (they used
    // to be counted in the burst and again as their own slots).
    const { container } = renderChart(sixTools(), { axisMode: "turns" });
    const { width } = plotBounds(container);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "width")).toBeCloseTo(width / 43);
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
