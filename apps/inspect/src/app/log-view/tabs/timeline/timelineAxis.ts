import type { ConnectionLimitChange } from "@tsmono/inspect-common/types";

import type { TimeWindow } from "./timelineData";

// Epoch seconds must fit the same Date range as the ISO-derived signals.
const kMaxEpochSeconds = 8.64e12;
const kMinTickSpacing = 80;
const kMaxAxisTicks = 1_000;
const kIntervals = [
  15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400,
];

export const isTimelineTimestamp = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value) <= kMaxEpochSeconds;

export const connectionHistoryError = (
  history: ConnectionLimitChange[]
): string | undefined =>
  history.some((event) => !isTimelineTimestamp(event.timestamp))
    ? "Invalid timeline: connection history contains an invalid or out-of-range timestamp."
    : undefined;

export const timelineWindowError = (window: TimeWindow): string | undefined => {
  if (!isTimelineTimestamp(window.start) || !isTimelineTimestamp(window.end)) {
    return "Invalid timeline: time range contains an invalid or out-of-range timestamp.";
  }
  if (window.end <= window.start) {
    return "Invalid timeline: time range must end after it starts.";
  }
  return undefined;
};

export interface AxisTick {
  time: number;
  showSeconds: boolean;
}

export const timelineAxisTicks = (
  window: TimeWindow,
  plotWidth: number
): AxisTick[] => {
  const error = timelineWindowError(window);
  if (error) throw new Error(error);
  if (!Number.isFinite(plotWidth) || plotWidth <= 0) return [];
  const span = window.end - window.start;
  const interval = kIntervals.find(
    (value) => (value / span) * plotWidth >= kMinTickSpacing
  );
  if (interval === undefined) return [];
  const first = Math.ceil(window.start / interval) * interval;
  const limit = Math.min(
    kMaxAxisTicks,
    Math.ceil(plotWidth / kMinTickSpacing) + 1
  );
  const ticks: AxisTick[] = [];
  let previous = -Infinity;
  // Count screen slots, not repeated floating-point addition: neither an
  // enormous viewport nor a rounded-away increment may create unbounded work.
  for (let index = 0; index < limit; index++) {
    const time = first + index * interval;
    if (time >= window.end || time <= previous) break;
    ticks.push({ time, showSeconds: interval < 60 });
    previous = time;
  }
  return ticks;
};
