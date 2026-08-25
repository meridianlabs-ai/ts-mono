import type { Event } from "@tsmono/inspect-common/types";
import type { FindMatch, FindSource } from "@tsmono/react/find";

import { findAllMatches } from "../transcript/search/sampleSearch";

import { createMaterializedFindSource } from "./materializedFindSource";

export const TRANSCRIPT_FIND_SCOPE = "transcript";

/**
 * The default transcript source: findAllMatches over the surface's
 * searchable events (hidden types already removed by the caller, D4/D5) in
 * chronological event order across all trajectories (D6). Only events the
 * row map can address are projected — counted ⇒ reachable — so unrenderable
 * anchors are excluded up front instead of discovered by trying (the old
 * SKIP_LIMIT dance).
 */
export function createTranscriptFindSource(
  events: Event[],
  eventToRow: Map<string, string>
): FindSource {
  const ordinalByEvent = new Map<string, number>();
  events.forEach((event, i) => {
    if (event.uuid) ordinalByEvent.set(event.uuid, i);
  });
  return createMaterializedFindSource({
    scopeId: TRANSCRIPT_FIND_SCOPE,
    materialize: (term) => {
      const out: FindMatch[] = [];
      // SampleMatch occurrences are per field; the contract's occurrence is
      // per anchor (running index across the event's projected fields).
      const perEvent = new Map<string, number>();
      for (const m of findAllMatches(events, term, eventToRow)) {
        const occurrence = perEvent.get(m.eventId) ?? 0;
        perEvent.set(m.eventId, occurrence + 1);
        const ordinal = ordinalByEvent.get(m.eventId);
        out.push({
          anchor: { kind: "event", id: m.eventId },
          occurrence,
          ...(ordinal !== undefined ? { ordinal } : {}),
        });
      }
      return out;
    },
  });
}
