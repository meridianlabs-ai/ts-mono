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

  it("gives a turn with no tool call the whole column", () => {
    const { container } = renderChart(
      [modelCall({ start: 0, end: 10, uuid: "m" })],
      { axisMode: "turns" }
    );
    const { width } = plotBounds(container);
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "width")).toBeCloseTo(width);
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
            onSelectMarker={() => {}}
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

  it.each([91, 1000])(
    "draws 6–10 separators and a label per separator plus turn 1 for %i turns",
    (n) => {
      const { container } = renderChart(nTurns(n), { axisMode: "turns" });
      const seps = separators(container);
      expect(seps.length).toBeGreaterThanOrEqual(6);
      expect(seps.length).toBeLessThanOrEqual(10);
      expect(tickLabels(container)).toHaveLength(seps.length + 1);
    },
    20000
  );

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
    // Resting legend: the fold's total is its members' (996 × 100).
    const legend = [
      ...container.querySelectorAll("text[class*='legendValue']"),
    ].map((el) => el.textContent);
    expect(legend).toContain("100k");

    // A cursor at the right edge reads every point: the fold's AT CURSOR
    // burn is the same aggregate (its context is the largest member's),
    // computed once for all five rows.
    const { right } = plotBounds(container);
    const hit = container.querySelector("rect[class*='plotHit']");
    if (!(hit instanceof SVGElement)) throw new Error("expected plot hit");
    fireEvent.mouseMove(hit, { clientX: right, clientY: 50 });
    const atCursor = [
      ...container.querySelectorAll("text[class*='legendValue']"),
    ].map((el) => el.textContent);
    expect(atCursor).toHaveLength(10);
    expect(atCursor.filter((v) => v === "100k")).toHaveLength(1);
    expect(atCursor.filter((v) => v === "max 100")).toHaveLength(1);
    expect(atCursor.filter((v) => v === "100")).toHaveLength(8);
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

  const legendValues = (container: HTMLElement) =>
    [...container.querySelectorAll("text[class*='legendValue']")].map(
      (el) => el.textContent
    );

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

  it("labels the fold's context as its largest member's while its burn sums", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChart(sixWithContext());
      // At rest: context legend "max 300", burn legend 400.
      expect(legendValues(container)).toContain("max 300");
      expect(legendValues(container)).toContain("400");
      expect(legendValues(container)).not.toContain("300");

      // At the cursor: the same labelled maximum in the legend and on the
      // card.
      hoverContextEdge(container);
      expect(legendValues(container)).toContain("max 300");
      expect(legendValues(container)).toContain("400");
      act(() => {
        vi.advanceTimersByTime(150);
      });
      const card = container.querySelector("[class*='tooltip']")?.textContent;
      expect(card).toContain("+2 more");
      expect(card).toContain("max 300");
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
      expect(legendValues(container)).toContain("max 300");
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
