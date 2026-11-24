import { describe, expect, it } from "vitest";

import { testConnectionLimitChange } from "@tsmono/inspect-common/testing";

import {
  connectionHistoryError,
  isTimelineTimestamp,
  timelineAxisTicks,
  timelineWindowError,
} from "./timelineAxis";

describe("timeline axis ticks", () => {
  it("preserves aligned 15-second ticks on a short window", () => {
    expect(timelineAxisTicks({ start: 0, end: 64 }, 800)).toEqual(
      [0, 15, 30, 45, 60].map((time) => ({ time, showSeconds: true }))
    );
  });

  it("preserves minute ticks and first-tick alignment", () => {
    expect(timelineAxisTicks({ start: 10, end: 3610 }, 800)).toEqual(
      [600, 1200, 1800, 2400, 3000, 3600].map((time) => ({
        time,
        showSeconds: false,
      }))
    );
  });

  it("supports pre-epoch windows", () => {
    expect(
      timelineAxisTicks({ start: -64, end: -1 }, 800).map((tick) => tick.time)
    ).toEqual([-60, -45, -30, -15]);
  });

  it.each([
    { start: 2 ** 57, end: 2 ** 57 + 64 },
    { start: -8.64e12 - 1, end: 0 },
    { start: 0, end: 8.64e12 + 1 },
    { start: NaN, end: 1 },
    { start: 0, end: Infinity },
    { start: 1, end: 1 },
    { start: 2, end: 1 },
  ])("rejects invalid window $start .. $end", (window) => {
    expect(timelineWindowError(window)).toMatch("Invalid timeline");
    expect(() => timelineAxisTicks(window, 800)).toThrow("Invalid timeline");
  });

  it.each([0, -1, Infinity, NaN])(
    "does not generate ticks for unusable width %s",
    (width) => {
      expect(timelineAxisTicks({ start: 0, end: 100 }, width)).toEqual([]);
    }
  );

  it("bounds ticks even for enormous finite viewports", () => {
    const ticks = timelineAxisTicks(
      { start: -8.64e12, end: 8.64e12 },
      Number.MAX_VALUE
    );
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(1000);
    expect(
      ticks.every(
        (tick, i) => i === 0 || tick.time > (ticks[i - 1]?.time ?? Infinity)
      )
    ).toBe(true);
  });

  it("retains endpoint-only axes for windows wider than the interval table", () => {
    expect(timelineAxisTicks({ start: -8.64e12, end: 8.64e12 }, 800)).toEqual(
      []
    );
  });

  it.each([NaN, Infinity, -Infinity, 2 ** 57])(
    "rejects raw timestamp %s",
    (value) => {
      expect(isTimelineTimestamp(value)).toBe(false);
    }
  );

  it.each([-8.64e12, 0, 8.64e12])(
    "accepts representable timestamp %s",
    (value) => {
      expect(isTimelineTimestamp(value)).toBe(true);
    }
  );
});

describe("connection history timestamps", () => {
  it("accepts empty history", () => {
    expect(connectionHistoryError([])).toBeUndefined();
  });
  it.each([NaN, Infinity, -Infinity, 2 ** 57, -(2 ** 57)])(
    "rejects unrepresentable timestamp %s",
    (timestamp) => {
      expect(
        connectionHistoryError([testConnectionLimitChange({ timestamp })])
      ).toMatch("Invalid timeline");
    }
  );
  it("accepts valid timestamps without changing the history", () => {
    const history = [-8.64e12, 0, 1736935200, 8.64e12].map((timestamp) =>
      testConnectionLimitChange({ timestamp })
    );
    const original = structuredClone(history);
    expect(connectionHistoryError(history)).toBeUndefined();
    expect(history).toEqual(original);
  });
});
