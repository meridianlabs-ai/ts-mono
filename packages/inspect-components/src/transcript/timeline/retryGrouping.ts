/**
 * Group consecutive failed-then-successful ModelEvent retries inside the
 * same `span_id` into a single visible event.
 *
 * Run AFTER `correctRetryTimestamps` so the success event's timestamp is
 * already past its preceding failed siblings (the stable key relies on that
 * post-correction uniqueness).
 *
 * Returns:
 * - `events` — input list with failed retry attempts removed; the success
 *    event survives unchanged.
 * - `attempts` — map keyed by the success event's stable key, holding the
 *    full ordered attempt list (failed first, success last). Single-attempt
 *    calls are not added to the map.
 *
 * When no retries are detected, returns the input array reference unchanged
 * so callers can memoize on identity.
 */

import type { Event, ModelEvent } from "@tsmono/inspect-common/types";

export const retryAttemptKey = (event: ModelEvent): string =>
  `${event.span_id ?? ""}:${event.timestamp}`;

export interface RetryGroupingResult {
  events: Event[];
  attempts: Map<string, ModelEvent[]>;
}

interface PendingFailed {
  event: ModelEvent;
  index: number;
}

export function groupRetryAttempts(events: Event[]): RetryGroupingResult {
  const attempts = new Map<string, ModelEvent[]>();
  const pendingFailed = new Map<string, PendingFailed[]>();
  const dropIndices = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.event !== "model") continue;

    const m = e;
    const key = m.span_id ?? "";

    if (m.error != null) {
      const run = pendingFailed.get(key) ?? [];
      run.push({ event: m, index: i });
      pendingFailed.set(key, run);
      continue;
    }

    const run = pendingFailed.get(key);
    if (run && run.length > 0) {
      attempts.set(retryAttemptKey(m), [...run.map((p) => p.event), m]);
      for (const p of run) dropIndices.add(p.index);
      pendingFailed.delete(key);
    }
  }

  if (dropIndices.size === 0) {
    return { events, attempts };
  }

  const filtered: Event[] = [];
  for (let i = 0; i < events.length; i++) {
    if (!dropIndices.has(i)) filtered.push(events[i]!);
  }
  return { events: filtered, attempts };
}
