/**
 * Synthesize a minimal event stream from a `SampleSkeleton`.
 *
 * The legacy transcript outline is a function of the full event list
 * (timeline main-view derivation + re-treeify + outline visitors). A chunked
 * sample never loads all events, but the skeleton carries exactly the
 * structure that pipeline consumes: the span tree, per-gap model counts,
 * persisted notables (score/checkpoint) with exact positions, and per-span
 * direct-child event-type counts. This module rebuilds a stand-in event
 * stream from that structure so the REAL pipeline (see `mainViewOutline.ts`)
 * can run unchanged — no ported twin to drift.
 *
 * Fidelity contract (what is and isn't reconstructed):
 *
 * - Span/step structure, model counts per gap, and notable positions are
 *   exact — outline rows, turn counts, and scoring rows match the legacy
 *   pipeline on well-formed logs (pinned by `mainViewOutline.test.ts`).
 * - Non-model, non-notable direct-child events ("strays": logger, info,
 *   sandbox, tool, ...) have known counts but unknown positions; they are
 *   emitted immediately after their span's begin marker. They exist to keep
 *   `filterEmpty` survival and type-filter behavior faithful; every type
 *   whose position could produce a visible outline row of its own (score,
 *   checkpoint) is a persisted notable with an exact position. Known
 *   deviation: error/compaction/sample_limit events are strays, so their
 *   outline rows (rare) anchor at the span start rather than their true
 *   position.
 * - Root-level plain events (e.g. a legacy log's `sample_init`, an
 *   interrupted eval's `sample_limit`) are absent: the skeleton records
 *   direct-child type counts per span only, and root notables are the only
 *   root-level events persisted.
 * - Event payloads are empty (no model input/output), so content-based
 *   utility-call detection (`wrapUtilityEvents`' system-prompt comparison)
 *   never fires. Utility model calls therefore count as ordinary turns.
 * - Timestamps are a synthetic monotonic clock in emission order — ordering
 *   is meaningful, wall time is not. Downstream consumers that display time
 *   (timeline swimlanes) must not use this stream.
 *
 * Every synthetic event carries a unique `uuid`; `ordinals` maps it to the
 * best-known index in the real event sequence for scroll anchoring (models
 * anchor at their gap's lower bound — the same convention the parity
 * harness signed off as allowance class 3).
 */
import type { Event } from "@tsmono/inspect-common/types";

import type { SampleSkeleton, SkeletonNotable, SkeletonSpan } from "./types";

export interface SyntheticStream {
  events: Event[];
  /** Synthetic event uuid -> ordinal in the real event sequence. */
  ordinals: ReadonlyMap<string, number>;
}

/** Legacy step pairs are skeleton spans with a synthesized `step-<i>` id. */
const isStepSpan = (span: SkeletonSpan): boolean => /^step-\d+$/.test(span.id);

/**
 * Single choke point for constructing events the pipeline treats as real.
 * The synthesized objects carry every field the transcript pipeline reads
 * (see module docstring); the cast acknowledges they are not full payloads.
 */
const synth = (fields: Record<string, unknown>): Event =>
  fields as unknown as Event;

const BASE_MS = Date.UTC(2020, 0, 1);

export const syntheticEventsFromSkeleton = (
  skel: SampleSkeleton
): SyntheticStream => {
  const events: Event[] = [];
  const ordinals = new Map<string, number>();
  let clock = 0;
  const timestamp = () => new Date(BASE_MS + ++clock * 1000).toISOString();

  const spans = skel.spans;
  const childSpans = new Map<number | null, number[]>();
  const spanNotables = new Map<number | null, SkeletonNotable[]>();
  spans.forEach((span, index) => {
    const parent = span.parent ?? null;
    childSpans.set(parent, [...(childSpans.get(parent) ?? []), index]);
  });
  for (const notable of skel.notables) {
    const parent = notable.span ?? null;
    spanNotables.set(parent, [
      ...(spanNotables.get(parent) ?? []),
      notable,
    ]);
  }

  /** Nearest non-step ancestor's span id (steps have no span identity). */
  const realSpanId = (index: number | null): string | null => {
    let current = index;
    while (current !== null) {
      const span = spans[current];
      if (span === undefined) return null;
      if (!isStepSpan(span)) return span.id;
      current = span.parent ?? null;
    }
    return null;
  };

  const push = (event: Event, uuid: string, ordinal: number) => {
    events.push(event);
    ordinals.set(uuid, ordinal);
  };

  const common = (uuid: string, spanId: string | null) => ({
    timestamp: timestamp(),
    pending: false,
    working_start: 0,
    uuid,
    span_id: spanId,
    metadata: null,
  });

  const emitModel = (spanIdx: number | null, gap: number, k: number, ordinal: number) => {
    const uuid = `synth-model-${spanIdx ?? "root"}-${gap}-${k}`;
    push(
      synth({
        event: "model",
        model: "",
        input: [],
        output: { model: "", choices: [], usage: null },
        ...common(uuid, realSpanId(spanIdx)),
      }),
      uuid,
      ordinal
    );
  };

  const emitNotable = (notable: SkeletonNotable) => {
    const uuid = `synth-notable-${notable.i}`;
    const spanId = realSpanId(notable.span ?? null);
    const fields =
      notable.type === "score"
        ? {
            event: "score",
            score: { value: "", answer: null, explanation: null, metadata: null },
            intermediate: false,
          }
        : notable.type === "checkpoint"
          ? { event: "checkpoint", checkpoint_id: notable.checkpoint_id }
          : { event: notable.type };
    push(synth({ ...fields, ...common(uuid, spanId) }), uuid, notable.i);
  };

  const emitStrays = (spanIdx: number) => {
    const span = spans[spanIdx];
    if (span === undefined) return;
    const notableCounts = new Map<string, number>();
    for (const notable of spanNotables.get(spanIdx) ?? []) {
      notableCounts.set(
        notable.type,
        (notableCounts.get(notable.type) ?? 0) + 1
      );
    }
    const spanId = realSpanId(spanIdx);
    for (const [type, count] of Object.entries(span.children)) {
      if (type === "model") continue;
      // One representative per type: strays exist to keep `filterEmpty`
      // survival and type-filter behavior faithful, and no stray type
      // yields per-event outline rows (see module docstring). Emitting
      // true counts is pure overhead (a monster span holds 60k+ sandbox
      // events) — capping keeps the stream proportional to the skeleton.
      if (count - (notableCounts.get(type) ?? 0) <= 0) continue;
      const uuid = `synth-stray-${spanIdx}-${type}`;
      const extra =
        type === "tool"
          ? { id: uuid, function: "", agent: null, events: [], result: null }
          : {};
      push(
        synth({ event: type, ...extra, ...common(uuid, spanId) }),
        uuid,
        span.begin + 1
      );
    }
  };

  /** Emit a container's gap models + items (child spans and notables). */
  const emitContents = (spanIdx: number | null) => {
    const span = spanIdx !== null ? spans[spanIdx] : undefined;
    const children = childSpans.get(spanIdx) ?? [];
    const notables = spanNotables.get(spanIdx) ?? [];
    type Item =
      | { kind: "span"; index: number; at: number }
      | { kind: "notable"; notable: SkeletonNotable; at: number };
    const items: Item[] = [
      ...children.map((index): Item => {
        const child = spans[index];
        return { kind: "span", index, at: child?.begin ?? 0 };
      }),
      ...notables.map(
        (notable): Item => ({ kind: "notable", notable, at: notable.i })
      ),
    ].sort((a, b) => a.at - b.at);

    // gap_models has length items+1; the root container has no record —
    // top-level phase spans cover all models, so root gaps are empty.
    const gaps = span?.gap_models ?? [];
    const gapLowerBound = (g: number): number => {
      if (g === 0) return span === undefined ? 0 : span.begin + 1;
      const prev = items[g - 1];
      if (prev === undefined) return span?.begin ?? 0;
      return prev.kind === "span"
        ? (spans[prev.index]?.extent[1] ?? prev.at) + 1
        : prev.at + 1;
    };
    const emitGap = (g: number) => {
      const count = gaps[g] ?? 0;
      const ordinal = gapLowerBound(g);
      for (let k = 0; k < count; k++) emitModel(spanIdx, g, k, ordinal);
    };

    items.forEach((item, g) => {
      emitGap(g);
      if (item.kind === "span") emitSpan(item.index);
      else emitNotable(item.notable);
    });
    emitGap(items.length);
  };

  const emitSpan = (spanIdx: number) => {
    const span = spans[spanIdx];
    if (span === undefined) return;
    const beginUuid = `synth-begin-${spanIdx}`;
    const endUuid = `synth-end-${spanIdx}`;
    if (isStepSpan(span)) {
      push(
        synth({
          event: "step",
          action: "begin",
          name: span.name,
          type: span.type ?? null,
          ...common(beginUuid, realSpanId(span.parent ?? null)),
        }),
        beginUuid,
        span.begin
      );
      emitStrays(spanIdx);
      emitContents(spanIdx);
      push(
        synth({
          event: "step",
          action: "end",
          name: span.name,
          type: span.type ?? null,
          ...common(endUuid, realSpanId(span.parent ?? null)),
        }),
        endUuid,
        span.extent[1]
      );
    } else {
      push(
        synth({
          event: "span_begin",
          id: span.id,
          parent_id: realSpanId(span.parent ?? null),
          name: span.name,
          type: span.type ?? null,
          ...common(beginUuid, span.id),
        }),
        beginUuid,
        span.begin
      );
      emitStrays(spanIdx);
      emitContents(spanIdx);
      push(
        synth({
          event: "span_end",
          id: span.id,
          ...common(endUuid, span.id),
        }),
        endUuid,
        span.extent[1]
      );
    }
  };

  emitContents(null);

  return { events, ordinals };
};
