/**
 * Scout-specific active timeline hook.
 *
 * Thin wrapper around the shared `useActiveTimeline` that persists the
 * active timeline index in URL search params via react-router-dom.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import {
  useActiveTimeline as useActiveTimelineShared,
  type Timeline,
  type UseActiveTimelineProps,
  type UseActiveTimelineResult,
} from "@tsmono/inspect-components/transcript";

// Re-export shared types for existing consumers.
export type { UseActiveTimelineResult };

// =============================================================================
// URL param helpers
// =============================================================================

const kTimelineViewParam = "timeline_view";
const kSelectedParam = "selected";

/** Creates UseActiveTimelineProps backed by URL search params. */
export function useActiveTimelineSearchParams(
  timelines: Timeline[]
): UseActiveTimelineProps {
  const [searchParams, setSearchParams] = useSearchParams();

  const viewParam = searchParams.get(kTimelineViewParam);

  // Resolve active index from URL param (case-insensitive name match)
  const activeIndex = useMemo(() => {
    if (viewParam === null || timelines.length <= 1) return 0;
    const lower = viewParam.toLowerCase();
    const idx = timelines.findIndex((tl) => tl.name.toLowerCase() === lower);
    return idx >= 0 ? idx : 0;
  }, [viewParam, timelines]);

  const onActiveChange = useCallback(
    (index: number) => {
      if (index < 0 || index >= timelines.length) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const tl = timelines[index];
          if (tl && timelines.length > 1 && index > 0) {
            next.set(kTimelineViewParam, tl.name);
          } else {
            next.delete(kTimelineViewParam);
          }
          // Reset selection when switching timelines
          next.delete(kSelectedParam);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams, timelines]
  );

  return { activeIndex, onActiveChange };
}

// =============================================================================
// Hook
// =============================================================================

export function useActiveTimeline(
  timelines: Timeline[]
): UseActiveTimelineResult {
  const props = useActiveTimelineSearchParams(timelines);
  return useActiveTimelineShared(timelines, props);
}
