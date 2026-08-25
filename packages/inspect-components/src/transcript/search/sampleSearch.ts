import type { Event } from "@tsmono/inspect-common/types";
import { findTermOccurrences } from "@tsmono/react/find";

import { extractEventFields } from "../eventText";
import { TimelineSpan } from "../timeline/core";
import type { SwimlaneRow } from "../timeline/swimlaneRows";
import { getAgents } from "../timeline/swimlaneRows";

/**
 * Build a map from event ID to the swimlane row key that contains it.
 *
 * Walks each row's agents. Within each agent, iterates through its `content`
 * but stops descending into nested agent spans — those events belong to
 * their own row (a separate entry in `state.rows`).
 *
 * If `state.rows` is sorted with deeper rows after their parents (the convention
 * established by `useTimeline`), processing them in order means the deepest row
 * wins when the same event would otherwise be reachable via multiple rows
 * (defensive — normally each event has exactly one containing row).
 */
export function buildEventToRowMap(rows: SwimlaneRow[]): Map<string, string> {
  const map = new Map<string, string>();
  // Sort by depth ascending so deeper rows overwrite shallower ones.
  const ordered = [...rows].sort((a, b) => a.depth - b.depth);

  for (const row of ordered) {
    for (const rowSpan of row.spans) {
      for (const agent of getAgents(rowSpan)) {
        recordRowEvents(agent, row.key, map);
      }
    }
  }
  return map;
}

function recordRowEvents(
  agent: TimelineSpan,
  rowKey: string,
  out: Map<string, string>
): void {
  const stack: TimelineSpan[] = [agent];
  while (stack.length > 0) {
    const span = stack.pop()!;
    for (const item of span.content) {
      if (item.type === "event") {
        // Use uuid (matching EventNode.id derivation in treeify.ts). Events without uuid get
        // synthetic node IDs that aren't on the raw event — those can't be reached via
        // sample-wide search and are skipped.
        const uuid = item.event.uuid;
        if (uuid) out.set(uuid, rowKey);
      } else {
        // Stop at nested agent spans — those events belong to their own row.
        if (item.spanType === "agent") continue;
        stack.push(item);
      }
    }
  }
}

export interface SampleMatch {
  rowKey: string;
  eventId: string;
  fieldKey: string;
  /** 0-based index of the field-tuple within extractEventFields output for this event.
   *  Distinguishes matches when extractEventFields emits the same fieldKey multiple times
   *  (e.g. multi-choice model events). */
  fieldIndex: number;
  /** 0-based index of this occurrence within (eventId, fieldKey, fieldIndex). */
  occurrenceIndex: number;
}

/**
 * Find every occurrence of `term` across the sample's events.
 *
 * Reuses `extractEventFields` so the searchable text exactly matches what
 * `eventSearchText` (the per-row counter) would extract. Events whose uuid
 * isn't in `eventToRow` are skipped (they're not addressable by row switch).
 *
 * Order: events in input order, fields in `extractEventFields` order,
 * occurrences left-to-right. Stable across calls with the same inputs.
 */
export function findAllMatches(
  events: Event[],
  term: string,
  eventToRow: Map<string, string>
): SampleMatch[] {
  if (!term) return [];
  const out: SampleMatch[] = [];
  for (const event of events) {
    const uuid = event.uuid;
    if (!uuid) continue;
    const rowKey = eventToRow.get(uuid);
    if (rowKey === undefined) continue;
    const fields = extractEventFields(event);
    let fieldIndex = 0;
    for (const [fieldKey, text] of fields) {
      // findTermOccurrences is the same variant scan the row highlighter
      // runs, so counts and highlights agree.
      const occurrences = findTermOccurrences(text, term);
      for (let i = 0; i < occurrences.length; i++) {
        out.push({
          rowKey,
          eventId: uuid,
          fieldKey,
          fieldIndex,
          occurrenceIndex: i,
        });
      }
      fieldIndex++;
    }
  }
  return out;
}
