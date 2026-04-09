/**
 * Builds the array of Timeline objects from events and optional server timelines.
 *
 * Extracted to avoid duplicating the buildTimeline + convertServerTimeline
 * memoization in every call site that needs the timelines array before
 * `useTranscriptTimeline` builds it internally.
 */

import { useMemo } from "react";

import type {
  Event,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";

import type { Timeline } from "../core";
import { buildTimeline, convertServerTimeline } from "../core";

export function useTimelinesArray(
  events: Event[],
  serverTimelines?: ServerTimeline[]
): Timeline[] {
  const builtTimeline = useMemo(() => buildTimeline(events), [events]);
  const convertedTimelines = useMemo(
    () =>
      serverTimelines && serverTimelines.length > 0
        ? serverTimelines.map((tl) => convertServerTimeline(tl, events))
        : null,
    [serverTimelines, events]
  );
  return convertedTimelines ?? [builtTimeline];
}
