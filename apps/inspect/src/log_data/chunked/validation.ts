import type { EventStats, SampleSkeleton } from "./types";

// The legacy overview expands each model into a full event, unlike the lazy
// transcript. Budget that eager representation separately from stored events.
export const MAX_SYNTHETIC_MODELS = 100_000;

const invalid = (detail: string): never => {
  throw new Error(`Invalid chunked sample: ${detail}`);
};

const count = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(`${label} must be a non-negative safe integer`);
  }
  return value;
};

const sumCounts = (values: readonly number[], label: string): number =>
  count(
    values.reduce((sum, value) => sum + count(value, label), 0),
    label
  );

const range = (value: unknown, label: string): [number, number] => {
  if (!Array.isArray(value) || value.length !== 2)
    return invalid(`invalid ${label} range`);
  return [count(value[0], `${label} start`), count(value[1], `${label} end`)];
};

export const validateMessageRefs = (
  refs: unknown,
  messageCount?: number
): void => {
  if (!Array.isArray(refs)) return invalid("message_refs must be an array");
  if (messageCount !== undefined) count(messageCount, "message sequence count");
  let total = 0;
  for (const ref of refs) {
    const [lo, hi] = range(ref, "message_refs");
    if (hi < lo || (messageCount !== undefined && hi > messageCount)) {
      invalid("message_refs range is outside the messages sequence");
    }
    total = count(total + (hi - lo), "conversation length");
  }
};

export const validateEventStats = (
  stats: EventStats,
  starts: readonly number[]
): number => {
  if (!Array.isArray(stats.chunks) || stats.chunks.length !== starts.length) {
    invalid("event stats do not match the event chunks");
  }
  let total = 0;
  stats.chunks.forEach((chunk, i) => {
    if (
      count(chunk.start, "event chunk start") !== total ||
      chunk.start !== starts[i]
    ) {
      invalid("event chunks must be contiguous");
    }
    const length = sumCounts(
      Object.values(chunk.type_counts),
      "event type count"
    );
    if (length === 0) invalid("empty event chunk");
    total = count(total + length, "event count");
  });
  return total;
};

export const validateSkeleton = (
  skeleton: SampleSkeleton,
  eventsCount: number
): void => {
  if (
    count(skeleton.counts.events, "skeleton event count") !== eventsCount ||
    count(skeleton.counts.models, "skeleton model count") > eventsCount
  ) {
    invalid("skeleton counts disagree with events");
  }
  const childModels = skeleton.spans.map(() => 0);
  let models = 0;
  const begins = new Set<number>();
  skeleton.spans.forEach((span, i) => {
    const begin = count(span.begin, "span begin");
    const [lo, hi] = range(span.extent, "span extent");
    if (lo > begin || begin > hi || hi >= eventsCount || begins.has(begin)) {
      invalid("span begin/extent is outside the event sequence");
    }
    begins.add(begin);
    if (
      count(span.events, "span event count") > hi - lo + 1 ||
      count(span.models, "span model count") > span.events
    )
      invalid("span counts exceed its extent");
    if (span.parent !== undefined) {
      const parentIndex = count(span.parent, "span parent");
      const parent = skeleton.spans[parentIndex];
      if (
        parentIndex >= i ||
        !parent ||
        lo < parent.extent[0] ||
        hi > parent.extent[1]
      ) {
        invalid("span parent/extent is inconsistent");
      }
      childModels[parentIndex] = count(
        (childModels[parentIndex] ?? 0) + span.models,
        "child models"
      );
    }
    if (!Array.isArray(span.gap_models)) invalid("gap_models must be an array");
    const gaps = sumCounts(span.gap_models, "gap model count");
    if (gaps > span.models)
      invalid("gap model counts exceed the span model count");
    models = count(models + gaps, "synthetic model count");
    sumCounts(Object.values(span.children), "span child count");
  });
  skeleton.spans.forEach((span, i) => {
    if (
      sumCounts(span.gap_models, "gap model count") + (childModels[i] ?? 0) !==
      span.models
    ) {
      invalid("gap and child model counts disagree with span model count");
    }
  });
  if (models > skeleton.counts.models)
    invalid("gap model counts exceed the sample model count");
  validateSyntheticModelBudget(skeleton);
};

export const validateSyntheticModelBudget = (
  skeleton: SampleSkeleton
): void => {
  let models = 0;
  for (const span of skeleton.spans) {
    models += sumCounts(span.gap_models, "gap model count");
    if (models > MAX_SYNTHETIC_MODELS) {
      throw new Error(
        `Chunked sample overview exceeds the supported limit of ${MAX_SYNTHETIC_MODELS.toLocaleString("en-US")} model events`
      );
    }
  }
};
