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
  collectBranchWithContext,
  collectRawEvents,
  computeMinimapSelection,
  computeRowLayouts,
  computeTimeMapping,
  convertServerTimeline,
  createShiftedMapping,
  defaultMarkerConfig,
  getBranchPrefix,
  getParentKeyFromBranch,
  getSelectedSpans,
  isSingleSpan,
  parseSelection,
  resolveForkTimestamp,
  rowHasEvents,
  type MarkerConfig,
  type MinimapSelection,
  type RowLayout,
  type SwimlaneRow,
  type Timeline,
  type TimelineSpan,
  type TimeMapping,
} from "@tsmono/inspect-components/transcript";

import type { Event, ServerTimeline } from "../../../types/api-types";

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
  const forkRelative = timelineOptions?.forkRelative ?? false;
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

  // Compute per-branch shifted time mappings when fork-relative mode is active.
  // Each branch row gets a mapping where its bar starts at the fork marker's
  // percentage position, preserving duration proportionality.
  const branchMappings = useMemo(() => {
    if (!forkRelative || !showBranches) return undefined;
    return computeBranchMappings(visibleRows, timeMapping, state.node);
  }, [forkRelative, showBranches, visibleRows, timeMapping, state.node]);

  const layouts = useMemo(
    () =>
      computeRowLayouts(
        visibleRows,
        timeMapping,
        markerConfig.depth,
        markerConfig.kinds,
        branchMappings
      ),
    [
      visibleRows,
      timeMapping,
      markerConfig.depth,
      markerConfig.kinds,
      branchMappings,
    ]
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

      // Extract the branchedFrom identifier from the child branch key.
      const branchMatch = /\/branch-([^/]*)-\d+$/.exec(childKey);
      const branchedFrom = branchMatch?.[1] ?? "";

      // Find the fork marker on the parent layout.
      const parentLayout = layoutByKey.get(parentKey);
      const forkMarker = parentLayout?.markers.find(
        (m) => m.kind === "branch" && m.reference === branchedFrom
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

// =============================================================================
// Fork-relative branch mapping computation
// =============================================================================

const kBranchKeyPattern = /\/branch-([^/]*)-(\d+)$/;

/**
 * Computes shifted time mappings for branch rows so their bars start at
 * the fork marker's position. Non-branch rows are omitted (they use the
 * trunk mapping).
 *
 * Processes rows in order, so parent branches are computed before nested
 * branches, allowing nested branches to shift relative to their parent's
 * shifted mapping.
 */
function computeBranchMappings(
  rows: ReadonlyArray<SwimlaneRow>,
  trunkMapping: TimeMapping,
  node: TimelineSpan
): ReadonlyMap<string, TimeMapping> {
  const mappings = new Map<string, TimeMapping>();

  // Build a lookup from row key → row for finding parent rows.
  const rowByKey = new Map<string, SwimlaneRow>();
  for (const row of rows) {
    rowByKey.set(row.key, row);
  }

  // Compute the parent's total time range for proportional width scaling.
  const nodeStartMs = node.startTime(false).getTime();
  const nodeEndMs = node.endTime(false).getTime();
  const parentTotalRangeMs = nodeEndMs - nodeStartMs;

  for (const row of rows) {
    if (!row.branch || !row.branchedFrom) continue;

    // Find parent row by stripping the /branch-...-N suffix.
    const parentKey = row.key.replace(kBranchKeyPattern, "");
    const parentRow = rowByKey.get(parentKey);
    if (!parentRow) continue;

    // Get the parent span to resolve the fork timestamp.
    const parentFirstSpan = parentRow.spans[0];
    const parentSpan =
      parentRow.spans.length === 1 &&
      parentFirstSpan &&
      isSingleSpan(parentFirstSpan)
        ? parentFirstSpan.agent
        : null;
    if (!parentSpan) continue;

    // Get the branch span from this row.
    const branchFirstSpan = row.spans[0];
    const branchSpan =
      row.spans.length === 1 && branchFirstSpan && isSingleSpan(branchFirstSpan)
        ? branchFirstSpan.agent
        : null;
    if (!branchSpan) continue;

    // Resolve the fork timestamp from the parent's content.
    const forkTimestamp = resolveForkTimestamp(parentSpan, branchSpan);

    // Use the parent's mapping (which may itself be shifted for nested branches).
    const parentMapping = mappings.get(parentKey) ?? trunkMapping;
    const forkPercent = parentMapping.toPercent(forkTimestamp);

    mappings.set(
      row.key,
      createShiftedMapping(
        row.startTime,
        row.endTime,
        forkPercent,
        parentTotalRangeMs
      )
    );
  }

  return mappings;
}
