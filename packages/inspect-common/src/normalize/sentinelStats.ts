import { isRecord, nullProtoRecord } from "@tsmono/util";

import type { SentinelEvalStats, SentinelStats } from "../types";

type SentinelStepCounts = NonNullable<SentinelStats["steps"]>[string];
type SentinelHumanReviewCounts = NonNullable<SentinelStats["human_reviews"]>;
type SentinelRemoteStats = NonNullable<SentinelStats["remote"]>;

const count = (raw: unknown): number => (typeof raw === "number" ? raw : 0);

/** A map of counts; entries that aren't numbers are dropped. */
const counts = (raw: unknown): Record<string, number> => {
  const entries = new Map<string, number>();
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "number") entries.set(key, value);
    }
  }
  return nullProtoRecord(entries);
};

const stepCounts = (raw: unknown): SentinelStepCounts | undefined =>
  isRecord(raw)
    ? {
        total: count(raw["total"]),
        judged: count(raw["judged"]),
        unjudged: counts(raw["unjudged"]),
      }
    : undefined;

/** Steps by stage; `null` stays `null`, as it means the counts are unavailable. */
const steps = (raw: unknown): SentinelStats["steps"] => {
  if (!isRecord(raw)) return null;
  const entries = new Map<string, SentinelStepCounts>();
  for (const [stage, value] of Object.entries(raw)) {
    const filled = stepCounts(value);
    if (filled) entries.set(stage, filled);
  }
  return nullProtoRecord(entries);
};

const humanReviews = (raw: unknown): SentinelHumanReviewCounts | null =>
  isRecord(raw)
    ? {
        total: count(raw["total"]),
        answered: count(raw["answered"]),
        timed_out: count(raw["timed_out"]),
        cancelled: count(raw["cancelled"]),
      }
    : null;

// proxy_url, version and release have no default, so an entry missing one
// would refuse to parse upstream and is dropped rather than shown half-filled
const remote = (raw: unknown): SentinelRemoteStats | null => {
  if (
    !isRecord(raw) ||
    typeof raw["proxy_url"] !== "string" ||
    typeof raw["version"] !== "number" ||
    typeof raw["release"] !== "string"
  ) {
    return null;
  }
  const withheld = raw["results_withheld"];
  return {
    proxy_url: raw["proxy_url"],
    version: raw["version"],
    release: raw["release"],
    model_calls: count(raw["model_calls"]),
    unrecorded_calls: count(raw["unrecorded_calls"]),
    results_withheld: typeof withheld === "boolean" ? withheld : null,
  };
};

const actions = (raw: unknown): SentinelStats["actions"] =>
  isRecord(raw) ? counts(raw) : null;

const sampleEntry = (raw: Record<string, unknown>): SentinelStats => {
  const reason = raw["incomplete_reason"];
  return {
    steps: steps(raw["steps"]),
    actions: actions(raw["actions"]),
    human_reviews: humanReviews(raw["human_reviews"]),
    complete: typeof raw["complete"] === "boolean" ? raw["complete"] : true,
    incomplete_reason: typeof reason === "string" ? reason : null,
    remote: remote(raw["remote"]),
  };
};

const evalEntry = (raw: Record<string, unknown>): SentinelEvalStats => ({
  steps: steps(raw["steps"]),
  actions: actions(raw["actions"]),
  human_reviews: humanReviews(raw["human_reviews"]),
  model_calls: count(raw["model_calls"]),
  unrecorded_calls: count(raw["unrecorded_calls"]),
  samples: count(raw["samples"]),
  incomplete_samples: count(raw["incomplete_samples"]),
});

const byName = <T>(
  raw: unknown,
  entry: (raw: Record<string, unknown>) => T
): Record<string, T> | null => {
  if (!isRecord(raw)) return null;
  const entries = new Map<string, T>();
  for (const [name, value] of Object.entries(raw)) {
    if (isRecord(value)) entries.set(name, entry(value));
  }
  return nullProtoRecord(entries);
};

/**
 * A sample's (or its summary's) `sentinel_stats`, with every defaulted field
 * filled as pydantic fills it, so the stats panel reads them unguarded.
 * Entries that aren't records are dropped.
 */
export const normalizeSentinelStats = (
  raw: unknown
): Record<string, SentinelStats> | null => byName(raw, sampleEntry);

/** `EvalStats.sentinel_stats`, filled as `normalizeSentinelStats` fills a sample's. */
export const normalizeSentinelEvalStats = (
  raw: unknown
): Record<string, SentinelEvalStats> | null => byName(raw, evalEntry);
