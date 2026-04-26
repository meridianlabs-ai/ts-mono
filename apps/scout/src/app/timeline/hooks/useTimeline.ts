/**
 * Scout-specific timeline state hook.
 *
 * Thin wrapper around the shared `useTimeline` that persists selection
 * state in URL search params via react-router-dom.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import {
  clearDeepLinkParams,
  createBranchSpan,
  findBranchesByBranchedFrom,
  useTimeline as useTimelineShared,
  type BranchLookupResult,
  type SelectOptions,
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
    (key: string | null, options?: SelectOptions) => {
      // In-view navigation: replace so swimlane row clicks don't pollute
      // the back-button stack. Row clicks also clear `?event=`/`?message=`
      // so any stale deep-link target doesn't fight the new selection;
      // message-resolution-driven selection changes pass `preserveDeepLink`
      // because their imperative scroll still needs the deep-link target.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (key) {
            next.set(kSelectedParam, key);
          } else {
            next.delete(kSelectedParam);
          }
          if (!options?.preserveDeepLink) clearDeepLinkParams(next);
          return next;
        },
        { replace: true }
      );
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
