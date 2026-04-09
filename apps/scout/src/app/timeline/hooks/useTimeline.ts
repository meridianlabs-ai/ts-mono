/**
 * Scout-specific timeline state hook.
 *
 * Thin wrapper around the shared `useTimeline` that persists selection
 * state in URL search params via react-router-dom.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createBranchSpan,
  findBranchesByBranchedFrom,
  useTimeline as useTimelineShared,
  type BranchLookupResult,
  type Timeline,
  type TimelineOptions,
  type TimelineState,
  type UseTimelineProps,
} from "@tsmono/inspect-components/transcript";

// Re-export shared types for existing consumers.
export type { BranchLookupResult, TimelineOptions, TimelineState };

// Re-export shared utilities that were previously co-located here.
export { createBranchSpan, findBranchesByBranchedFrom };

// =============================================================================
// URL param helpers
// =============================================================================

const kSelectedParam = "selected";

/** Creates UseTimelineProps backed by URL search params. */
export function useTimelineSearchParams(): UseTimelineProps {
  const [searchParams, setSearchParams] = useSearchParams();

  const selected = searchParams.get(kSelectedParam) ?? null;

  const onSelect = useCallback(
    (key: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (key) {
          next.set(kSelectedParam, key);
        } else {
          next.delete(kSelectedParam);
        }
        next.delete("event");
        next.delete("message");
        return next;
      });
    },
    [setSearchParams]
  );

  return { selected, onSelect };
}

// =============================================================================
// Hook
// =============================================================================

export function useTimeline(
  timeline: Timeline,
  options?: TimelineOptions
): TimelineState {
  const props = useTimelineSearchParams();
  return useTimelineShared(timeline, options, props);
}
