import type { SentinelStats } from "@tsmono/inspect-common/types";

import { unjudgedReasonText } from "../transcript/transform/toolSentinels";

/** The fields of a sample summary the eval's sentinel panel reads. */
export interface SentinelSampleSummary {
  id: string | number;
  epoch: number;
  sentinel_stats?: Record<string, SentinelStats> | null;
}

export type SampleStatus = "terminated" | "not checked" | "left out";

/** A sample a reader of the eval's sentinel stats should look at. */
export interface NotableSample {
  id: string | number;
  epoch: number;
  status: SampleStatus;
  reason: string;
}

const kStatusOrder: readonly SampleStatus[] = [
  "terminated",
  "not checked",
  "left out",
];

const notableOf = (
  stats: SentinelStats
): Omit<NotableSample, "id" | "epoch"> | undefined => {
  if ((stats.actions?.terminate ?? 0) > 0) {
    return { status: "terminated", reason: "the sentinel ended the sample" };
  }
  const unjudged = new Map<string, number>();
  for (const counts of Object.values(stats.steps ?? {})) {
    for (const [reason, n] of Object.entries(counts.unjudged)) {
      unjudged.set(reason, (unjudged.get(reason) ?? 0) + n);
    }
  }
  const total = [...unjudged.values()].reduce((sum, n) => sum + n, 0);
  if (total > 0) {
    const reasons = [...unjudged]
      .filter(([, n]) => n > 0)
      .map(([reason]) => unjudgedReasonText(reason))
      .join(", ");
    return {
      status: "not checked",
      reason: `${total} ${total === 1 ? "step" : "steps"} · ${reasons}`,
    };
  }
  if (!stats.complete) {
    return {
      status: "left out",
      reason: "sentinel data incomplete · not in the numbers above",
    };
  }
  return undefined;
};

/**
 * The samples where one sentinel ended the sample, left steps unchecked, or
 * whose stats were left out of the eval's as incomplete, grouped by status.
 * A sample in more than one group is listed in the first.
 */
export const notableSamples = (
  samples: readonly SentinelSampleSummary[],
  sentinel: string
): NotableSample[] => {
  const notable: NotableSample[] = [];
  for (const sample of samples) {
    const stats = sample.sentinel_stats?.[sentinel];
    const found = stats ? notableOf(stats) : undefined;
    if (found) notable.push({ id: sample.id, epoch: sample.epoch, ...found });
  }
  const rank = (s: NotableSample) => kStatusOrder.indexOf(s.status);
  return notable.sort((a, b) => rank(a) - rank(b));
};
