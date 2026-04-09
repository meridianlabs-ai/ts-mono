/**
 * Scout-specific orchestration hook for timeline swimlanes.
 *
 * Thin wrapper around the shared `useTranscriptTimeline` that injects
 * URL-param-backed selection and active-timeline state.
 */

import type { Event } from "@tsmono/inspect-common/types";
import {
  defaultMarkerConfig,
  useTimelinesArray,
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
  const timelines = useTimelinesArray(events, serverTimelines);
  const activeTimelineProps = useActiveTimelineSearchParams(timelines);

  return useTranscriptTimelineShared(
    events,
    markerConfig,
    timelineOptions,
    serverTimelines,
    { timelineProps, activeTimelineProps }
  );
}
