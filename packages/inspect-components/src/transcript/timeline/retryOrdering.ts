/**
 * Repair retry-inverted ModelEvent timestamps for display ordering.
 *
 * When `model.generate()` retries internally, each attempt emits its own
 * ModelEvent (failed attempts carry `error`, the final attempt is the
 * successful one). On the Python side, after retries complete, the
 * successful event's `timestamp` is rewritten to a value captured *before*
 * any retry — so that whole-call accounting (working_time) reflects the full
 * duration. The side effect is that the success event ends up with a
 * timestamp earlier than its preceding failed-retry siblings, and any sort
 * by timestamp places it ahead of attempts that actually preceded it.
 *
 * This helper detects the inversion and clones offending events with their
 * `timestamp` clamped so ModelEvents within a span are non-decreasing in
 * emission order. Other timing fields (`working_start`, `working_time`,
 * `completed`) are preserved so accounting stays intact.
 */

import type { Event } from "@tsmono/inspect-common/types";

const EPSILON_MS = 1;

function bumpAfter(iso: string): string {
  const t = new Date(iso).getTime();
  return new Date(t + EPSILON_MS).toISOString();
}

/**
 * Return `events` with retry-inverted ModelEvent timestamps repaired.
 *
 * Returns the input array reference unchanged when no inversion is
 * detected, so callers can safely memoize on the result.
 */
export function correctRetryTimestamps(events: Event[]): Event[] {
  const lastModelTs = new Map<string | null, string>();
  let result: Event[] | null = null;

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.event !== "model") continue;
    if (!e.timestamp) continue;

    const key = e.span_id ?? null;
    const prev = lastModelTs.get(key);
    if (prev != null && e.timestamp < prev) {
      const corrected = bumpAfter(prev);
      if (!result) result = events.slice();
      result[i] = { ...e, timestamp: corrected };
      lastModelTs.set(key, corrected);
    } else {
      lastModelTs.set(key, e.timestamp);
    }
  }

  return result ?? events;
}
