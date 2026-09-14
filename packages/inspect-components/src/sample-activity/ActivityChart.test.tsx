// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSpanBeginEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { Event, ModelEvent } from "@tsmono/inspect-common/types";

import { ActivityChart, ActivityChartProps } from "./ActivityChart";
import { deriveActivityData } from "./activityData";
import { ImmediateResizeObserver, iso, kTestChartWidth } from "./testHelpers";

// Geometry of the stubbed 1000px chart for a single-conversation sample:
// 30px y-gutter, 10px right inset → a 960px plot.
const kPlotLeft = 30;
const kPlotRight = kTestChartWidth - 10;
const kPlotWidth = kPlotRight - kPlotLeft;

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
    const model = container.querySelector("rect[class*='modelSpan']");
    expect(attr(model, "width")).toBeCloseTo(kPlotWidth / 2);
    const tool = container.querySelector("rect[class*='toolSpan']");
    expect(attr(tool, "x")).toBeCloseTo(kPlotLeft + kPlotWidth / 2);
    expect(attr(tool, "width")).toBeCloseTo(kPlotWidth / 2);
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
    expect(xs).toContain(kPlotLeft + kPlotWidth / 2);
  });

  it("lands pre-uuid curve points on their turn's right edge", () => {
    // Older logs have timestamps but no event uuids: the points still
    // belong to the turn that produced them.
    const { container } = renderChart(
      [modelCall({ start: 0, end: 10 }), modelCall({ start: 20, end: 30 })],
      { axisMode: "turns" }
    );
    const dots = container.querySelectorAll("circle[class*='contextDot']");
    expect(attr(dots[0] ?? null, "cx")).toBe(kPlotLeft + kPlotWidth / 2);
    expect(attr(dots[1] ?? null, "cx")).toBe(kPlotRight);
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

});

describe("ActivityChart curve read-outs", () => {
});
