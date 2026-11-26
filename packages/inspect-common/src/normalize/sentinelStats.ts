import { isRecord, nullProtoRecord } from "@tsmono/util";

import type { SentinelEvalStats, SentinelStats } from "../types";

type SentinelStepCounts = NonNullable<SentinelStats["steps"]>[string];
type SentinelHumanReviewCounts = NonNullable<SentinelStats["human_reviews"]>;
type SentinelRemoteStats = NonNullable<SentinelStats["remote"]>;

const isOptional = <T>(
  value: unknown,
  isT: (value: unknown) => value is T
): value is T | null | undefined => value == null || isT(value);

const isNumber = (value: unknown): value is number => typeof value === "number";

const isString = (value: unknown): value is string => typeof value === "string";

const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

const isCounts = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every(isNumber);

const isStepCounts = (value: unknown): value is SentinelStepCounts =>
  isRecord(value) &&
  isNumber(value["total"]) &&
  isNumber(value["judged"]) &&
  isCounts(value["unjudged"]);

const isSteps = (value: unknown): value is Record<string, SentinelStepCounts> =>
  isRecord(value) && Object.values(value).every(isStepCounts);

const isHumanReviews = (value: unknown): value is SentinelHumanReviewCounts =>
  isRecord(value) &&
  isNumber(value["total"]) &&
  isNumber(value["answered"]) &&
  isNumber(value["timed_out"]) &&
  isNumber(value["cancelled"]);

const isRemote = (value: unknown): value is SentinelRemoteStats =>
  isRecord(value) &&
  isString(value["proxy_url"]) &&
  isNumber(value["version"]) &&
  isString(value["release"]) &&
  isNumber(value["model_calls"]) &&
  isNumber(value["unrecorded_calls"]) &&
  isOptional(value["results_withheld"], isBoolean);

const isSampleEntry = (value: unknown): value is SentinelStats =>
  isRecord(value) &&
  isBoolean(value["complete"]) &&
  isOptional(value["incomplete_reason"], isString) &&
  isOptional(value["steps"], isSteps) &&
  isOptional(value["actions"], isCounts) &&
  isOptional(value["human_reviews"], isHumanReviews) &&
  isOptional(value["remote"], isRemote);

const isEvalEntry = (value: unknown): value is SentinelEvalStats =>
  isRecord(value) &&
  isNumber(value["samples"]) &&
  isNumber(value["incomplete_samples"]) &&
  isNumber(value["model_calls"]) &&
  isNumber(value["unrecorded_calls"]) &&
  isOptional(value["steps"], isSteps) &&
  isOptional(value["actions"], isCounts) &&
  isOptional(value["human_reviews"], isHumanReviews);

const count = (value: unknown): number => (isNumber(value) ? value : 0);

/** A map of counts; entries that aren't numbers are dropped. */
const counts = (value: unknown): Record<string, number> => {
  if (isCounts(value)) return value;
  const entries = new Map<string, number>();
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (isNumber(entry)) entries.set(key, entry);
    }
  }
  return nullProtoRecord(entries);
};

const optionalCounts = (value: unknown): Record<string, number> | null =>
  isRecord(value) ? counts(value) : null;

const stepCounts = (value: Record<string, unknown>): SentinelStepCounts =>
  isStepCounts(value)
    ? value
    : {
        ...value,
        total: count(value["total"]),
        judged: count(value["judged"]),
        unjudged: counts(value["unjudged"]),
      };

/** Steps by stage; `null` means the counts are unavailable. */
const steps = (value: unknown): SentinelStats["steps"] => {
  if (!isRecord(value)) return null;
  if (isSteps(value)) return value;
  const entries = new Map<string, SentinelStepCounts>();
  for (const [stage, entry] of Object.entries(value)) {
    if (isRecord(entry)) entries.set(stage, stepCounts(entry));
  }
  return nullProtoRecord(entries);
};

const humanReviews = (value: unknown): SentinelHumanReviewCounts | null => {
  if (!isRecord(value)) return null;
  if (isHumanReviews(value)) return value;
  return {
    ...value,
    total: count(value["total"]),
    answered: count(value["answered"]),
    timed_out: count(value["timed_out"]),
    cancelled: count(value["cancelled"]),
  };
};

// proxy_url, version and release have no default, so an entry missing one
// would refuse to parse upstream and is dropped rather than shown half-filled
const remote = (value: unknown): SentinelRemoteStats | null => {
  if (isRemote(value)) return value;
  if (
    !isRecord(value) ||
    !isString(value["proxy_url"]) ||
    !isNumber(value["version"]) ||
    !isString(value["release"])
  ) {
    return null;
  }
  const withheld = value["results_withheld"];
  return {
    ...value,
    proxy_url: value["proxy_url"],
    version: value["version"],
    release: value["release"],
    model_calls: count(value["model_calls"]),
    unrecorded_calls: count(value["unrecorded_calls"]),
    results_withheld: isBoolean(withheld) ? withheld : null,
  };
};

const sampleEntry = (value: Record<string, unknown>): SentinelStats => {
  if (isSampleEntry(value)) return value;
  const reason = value["incomplete_reason"];
  return {
    ...value,
    steps: steps(value["steps"]),
    actions: optionalCounts(value["actions"]),
    human_reviews: humanReviews(value["human_reviews"]),
    complete: isBoolean(value["complete"]) ? value["complete"] : true,
    incomplete_reason: isString(reason) ? reason : null,
    remote: remote(value["remote"]),
  };
};

const evalEntry = (value: Record<string, unknown>): SentinelEvalStats =>
  isEvalEntry(value)
    ? value
    : {
        ...value,
        steps: steps(value["steps"]),
        actions: optionalCounts(value["actions"]),
        human_reviews: humanReviews(value["human_reviews"]),
        model_calls: count(value["model_calls"]),
        unrecorded_calls: count(value["unrecorded_calls"]),
        samples: count(value["samples"]),
        incomplete_samples: count(value["incomplete_samples"]),
      };

const byName = <T>(
  value: unknown,
  isEntry: (value: unknown) => value is T,
  entry: (value: Record<string, unknown>) => T
): Record<string, T> | null | undefined => {
  if (value === undefined || value === null) return value;
  if (!isRecord(value)) return null;
  if (isByName(value, isEntry)) return value;
  const entries = new Map<string, T>();
  for (const [name, stats] of Object.entries(value)) {
    if (isRecord(stats)) entries.set(name, entry(stats));
  }
  return nullProtoRecord(entries);
};

const isByName = <T>(
  value: Record<string, unknown>,
  isEntry: (value: unknown) => value is T
): value is Record<string, T> => Object.values(value).every(isEntry);

/**
 * A sample's (or its summary's) `sentinel_stats`, with every defaulted field
 * filled as pydantic fills it, so the stats panel reads them unguarded.
 * Entries that aren't records are dropped, and fields the viewer doesn't know
 * are kept. Absent and `null` stay as they are, and stats that need nothing
 * filled are returned as they came.
 */
export const normalizeSentinelStats = (
  value: unknown
): Record<string, SentinelStats> | null | undefined =>
  byName(value, isSampleEntry, sampleEntry);

/** `EvalStats.sentinel_stats`, filled as `normalizeSentinelStats` fills a sample's. */
export const normalizeSentinelEvalStats = (
  value: unknown
): Record<string, SentinelEvalStats> | null | undefined =>
  byName(value, isEvalEntry, evalEntry);
