/**
 * Orchestration hook for timeline swimlanes in the transcript view.
 *
 * Bridges the flat Event[] from the transcript API to the timeline swimlane
 * pipeline: buildTimeline → useTimeline → layouts + selectedEvents.
 *
 * Always runs through collectRawEvents so that sourceSpans (used for
 * agent card rendering) are populated for the selected row.
 */

import { useMemo } from "react";

import {
  buildTimeline,
  convertServerTimeline,
  type Timeline,
  type TimelineSpan,
} from "../../../components/transcript/timeline";
import type { Event, ServerTimeline } from "../../../types/api-types";
import type { MinimapSelection } from "../components/TimelineMinimap";
import {
  collectBranchWithContext,
  collectRawEvents,
  computeMinimapSelection,
  getBranchPrefix,
  getParentKeyFromBranch,
  getSelectedSpans,
  parseSelection,
} from "../timelineEventNodes";
import { defaultMarkerConfig, type MarkerConfig } from "../utils/markers";
import {
  computeRowLayouts,
  rowHasEvents,
  type RowLayout,
} from "../utils/swimlaneLayout";
import { isSingleSpan } from "../utils/swimlaneRows";
import { computeTimeMapping, type TimeMapping } from "../utils/timeMapping";

import { useActiveTimeline } from "./useActiveTimeline";
import {
  useTimeline,
  type TimelineOptions,
  type TimelineState,
} from "./useTimeline";

const emptySourceSpans: ReadonlyMap<string, TimelineSpan> = new Map();
const emptyHighlightedKeys: ReadonlyMap<string, number> = new Map();

interface TranscriptTimelineResult {
  /** The built Timeline. Always present (even for root-only timelines). */
  timeline: Timeline;
  /** Full useTimeline state (node, rows, navigation). */
  state: TimelineState;
  /** Computed row layouts for the swimlane UI. */
  layouts: RowLayout[];
  /** Time mapping for the current node (may compress gaps). */
  timeMapping: TimeMapping;
  /** Time mapping for the root node (for minimap). */
  rootTimeMapping: TimeMapping;
  /** Events scoped to the selected swimlane row (or all events if no child selected). */
  selectedEvents: Event[];
  /** Agent spans keyed by span ID, for attaching to EventNodes. */
  sourceSpans: ReadonlyMap<string, TimelineSpan>;
  /** Minimap selection for the breadcrumb row. */
  minimapSelection: MinimapSelection | undefined;
  /** Whether the timeline has meaningful structure (non-empty root with children). */
  hasTimeline: boolean;
  /** All available timelines (may be 1 or more). */
  timelines: Timeline[];
  /** Index of the currently active timeline. */
  activeTimelineIndex: number;
  /** Switch the active timeline by index. Resets selection. */
  setActiveTimeline: (index: number) => void;
  /** Map from row key → number of compaction regions (only for rows with compactions). */
  regionCounts: ReadonlyMap<string, number>;
  /** Event ID to scroll to when a branch is selected (the branch separator). Null for non-branch selections. */
  branchScrollTarget: string | null;
  /** Row key → highlight clip percentage (0–100) within the bar area.
   *  The selected branch row clips at 100; ancestor rows clip at the
   *  fork marker's percentage position so only the pre-fork portion
   *  of the bar is highlighted. */
  highlightedKeys: ReadonlyMap<string, number>;
}

export function useTranscriptTimeline(
  events: Event[],
  markerConfig: MarkerConfig = defaultMarkerConfig,
  timelineOptions?: TimelineOptions,
  serverTimelines?: ServerTimeline[]
): TranscriptTimelineResult {
  const includeUtility = timelineOptions?.includeUtility ?? false;
  const showBranches = timelineOptions?.showBranches ?? false;
  const builtTimeline = useMemo(() => buildTimeline(events), [events]);
  const convertedTimelines = useMemo(
    () =>
      serverTimelines && serverTimelines.length > 0
        ? serverTimelines.map((tl) => convertServerTimeline(tl, events))
        : null,
    [serverTimelines, events]
  );
  const timelines = convertedTimelines ?? [builtTimeline];

  const {
    active: timeline,
    activeIndex: activeTimelineIndex,
    setActive: setActiveTimeline,
  } = useActiveTimeline(timelines);

  const state = useTimeline(timeline, timelineOptions);

  // Filter out child rows whose spans contain no events.
  // The parent row (depth 0) is always kept.
  const visibleRows = useMemo(
    () => state.rows.filter((row) => row.depth === 0 || rowHasEvents(row)),
    [state.rows]
  );

  const timeMapping = useMemo(
    () => computeTimeMapping(state.node),
    [state.node]
  );

  const rootTimeMapping = useMemo(
    () => computeTimeMapping(timeline.root),
    [timeline.root]
  );

  const layouts = useMemo(
    () =>
      computeRowLayouts(
        visibleRows,
        timeMapping,
        markerConfig.depth,
        markerConfig.kinds
      ),
    [visibleRows, timeMapping, markerConfig.depth, markerConfig.kinds]
  );

  const { selectedEvents, sourceSpans, branchScrollTarget } = useMemo(() => {
    const parsed = parseSelection(state.selected);
    const spans = getSelectedSpans(state.rows, state.selected);
    if (spans.length === 0) {
      return {
        selectedEvents: events,
        sourceSpans: emptySourceSpans,
        branchScrollTarget: null as string | null,
      };
    }

    // Detect branch row selection — show parent context up to fork point
    const rowKey = parsed?.rowKey ?? "";
    const row = state.rows.find((r) => r.key === rowKey);
    if (row?.branch && spans.length === 1) {
      const branchSpan = spans[0]!;
      const collected = collectBranchWithContext(
        state.rows,
        rowKey,
        branchSpan,
        {
          includeUtility,
          showBranches,
          branchPrefix: getBranchPrefix(state.rows, state.selected),
        }
      );
      return {
        selectedEvents: collected.events,
        sourceSpans: collected.sourceSpans,
        branchScrollTarget: branchSpan.id,
      };
    }

    // Non-branch: existing behavior
    const collected = collectRawEvents(spans, {
      includeUtility,
      regionIndex: parsed?.regionIndex ?? null,
      showBranches,
      branchPrefix: getBranchPrefix(state.rows, state.selected),
    });
    return {
      selectedEvents: collected.events,
      sourceSpans: collected.sourceSpans,
      branchScrollTarget: null as string | null,
    };
  }, [events, state.rows, state.selected, includeUtility, showBranches]);

  const minimapSelection = useMemo(
    () => computeMinimapSelection(state.rows, state.selected),
    [state.rows, state.selected]
  );

  // Compute region counts: for each single-span row, count compaction events + 1.
  // Only includes rows with at least one compaction event.
  const regionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of state.rows) {
      const firstSpan = row.spans[0];
      if (row.spans.length === 1 && firstSpan && isSingleSpan(firstSpan)) {
        const agent = firstSpan.agent;
        let compactionCount = 0;
        for (const item of agent.content) {
          if (item.type === "event" && item.event.event === "compaction") {
            compactionCount++;
          }
        }
        if (compactionCount > 0) {
          counts.set(row.key, compactionCount + 1);
        }
      }
    }
    return counts;
  }, [state.rows]);

  // Compute highlighted rows with clip percentages when a branch is selected.
  // The selected branch clips at 100% (full bar). Each ancestor clips at the
  // fork marker's percentage so only the pre-fork portion is highlighted.
  const highlightedKeys = useMemo(() => {
    const parsed = parseSelection(state.selected);
    const rowKey = parsed?.rowKey ?? "";
    const row = state.rows.find((r) => r.key === rowKey);
    if (!row?.branch) return emptyHighlightedKeys;

    // Build a layout lookup by key for marker position queries.
    const layoutByKey = new Map<string, RowLayout>();
    for (const layout of layouts) {
      layoutByKey.set(layout.key, layout);
    }

    const keys = new Map<string, number>();
    // The selected branch itself highlights at 100%.
    keys.set(rowKey, 100);

    // Walk up ancestors, clipping each at its fork marker position.
    let childKey = rowKey;
    while (true) {
      const parentKey = getParentKeyFromBranch(childKey);
      if (!parentKey) break;

      // Extract the forkedAt UUID from the child branch key.
      const branchMatch = /\/branch-([^/]*)-\d+$/.exec(childKey);
      const forkedAt = branchMatch?.[1] ?? "";

      // Find the fork marker on the parent layout.
      const parentLayout = layoutByKey.get(parentKey);
      const forkMarker = parentLayout?.markers.find(
        (m) => m.kind === "branch" && m.reference === forkedAt
      );

      // Clip at the fork marker's position, or 100% if not found.
      keys.set(parentKey, forkMarker?.left ?? 100);
      childKey = parentKey;
    }
    return keys;
  }, [state.selected, state.rows, layouts]);

  const hasTimeline =
    timeline.root.content.length > 0 &&
    (timeline.root.content.some((item) => item.type === "span") ||
      timeline.root.branches.length > 0);

  return {
    timeline,
    state,
    layouts,
    timeMapping,
    rootTimeMapping,
    selectedEvents,
    sourceSpans,
    minimapSelection,
    hasTimeline,
    timelines,
    activeTimelineIndex,
    setActiveTimeline,
    regionCounts,
    branchScrollTarget,
    highlightedKeys,
  };
}
