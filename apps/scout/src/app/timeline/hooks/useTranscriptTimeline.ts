/**
 * Scout-specific orchestration hook for timeline swimlanes.
 *
 * Thin wrapper around the shared `useTranscriptTimeline` that injects
 * URL-param-backed selection and active-timeline state.
 */

import { useMemo } from "react";

import type { Event } from "@tsmono/inspect-common/types";
import {
  buildTimeline,
  convertServerTimeline,
  defaultMarkerConfig,
  useTranscriptTimeline as useTranscriptTimelineShared,
  type MarkerConfig,
  type TranscriptTimelineResult,
} from "@tsmono/inspect-components/transcript";

import type { ServerTimeline } from "../../../types/api-types";

import { useActiveTimelineSearchParams } from "./useActiveTimeline";
import { useTimelineSearchParams, type TimelineOptions } from "./useTimeline";

// Re-export shared types for existing consumers.
export type { TranscriptTimelineResult };

export function useTranscriptTimeline(
  events: Event[],
  markerConfig: MarkerConfig = defaultMarkerConfig,
  timelineOptions?: TimelineOptions,
  serverTimelines?: ServerTimeline[]
): TranscriptTimelineResult {
  const timelineProps = useTimelineSearchParams();

  // Build the timelines here so we can resolve the URL-param-based active
  // index. The shared hook rebuilds them internally (memoized), so the
  // duplication is negligible.
  const builtTimeline = useMemo(() => buildTimeline(events), [events]);
  const convertedTimelines = useMemo(
    () =>
      serverTimelines && serverTimelines.length > 0
        ? serverTimelines.map((tl) => convertServerTimeline(tl, events))
        : null,
    [serverTimelines, events]
  );
  const timelines = convertedTimelines ?? [builtTimeline];

  const activeTimelineProps = useActiveTimelineSearchParams(timelines);

  return useTranscriptTimelineShared(
    events,
    markerConfig,
    timelineOptions,
    serverTimelines,
    { timelineProps, activeTimelineProps }
  );
}
