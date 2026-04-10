/**
 * Orchestration hook for timeline swimlanes in the transcript view.
 *
 * Bridges the flat Event[] from the transcript API to the timeline swimlane
 * pipeline: buildTimeline -> useTimeline -> layouts + selectedEvents.
 *
 * Always runs through collectRawEvents so that sourceSpans (used for
 * agent card rendering) are populated for the selected row.
 */

import { useMemo } from "react";

import type {
  Event,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";

import type { Timeline, TimelineSpan } from "../core";
import {
  defaultMarkerConfig,
  resolveForkTimestamp,
  type MarkerConfig,
} from "../markers";
import {
  computeRowLayouts,
  rowHasEvents,
  type RowLayout,
} from "../swimlaneLayout";
import { isSingleSpan, type SwimlaneRow } from "../swimlaneRows";
import {
  collectBranchWithContext,
  collectRawEvents,
  computeMinimapSelection,
  getBranchPrefix,
  getParentKeyFromBranch,
  getSelectedSpans,
  parseSelection,
  type MinimapSelection,
} from "../timelineEventNodes";
import {
  computeTimeMapping,
  createShiftedMapping,
  type TimeMapping,
} from "../timeMapping";

import {
  useActiveTimeline,
  type UseActiveTimelineProps,
} from "./useActiveTimeline";
import {
  useTimeline,
  type TimelineOptions,
  type TimelineState,
  type UseTimelineProps,
} from "./useTimeline";
import { useTimelinesArray } from "./useTimelinesArray";

const emptySourceSpans: ReadonlyMap<string, TimelineSpan> = new Map();
const emptyHighlightedKeys: ReadonlyMap<string, number> = new Map();

export interface TranscriptTimelineResult {
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
  /** Map from row key -> number of compaction regions (only for rows with compactions). */
  regionCounts: ReadonlyMap<string, number>;
  /** Event ID to scroll to when a branch is selected (the branch separator). Null for non-branch selections. */
  branchScrollTarget: string | null;
  /** Row key -> highlight clip percentage (0-100) within the bar area. */
  highlightedKeys: ReadonlyMap<string, number>;
  /** Agent name for the outline header (selected row name or root name). */
  outlineAgentName: string;
}

export interface UseTranscriptTimelineOptions {
  /** The flat event array to process. */
  events: Event[];
  /** Marker configuration for swimlane layout. Defaults to `defaultMarkerConfig`. */
  markerConfig?: MarkerConfig;
  /** Timeline agent filtering/branch options. */
  timelineOptions?: TimelineOptions;
  /** Server-provided timelines (used when available instead of building from events). */
  serverTimelines?: ServerTimeline[];
  /** Props for timeline selection state. */
  timelineProps?: UseTimelineProps;
  /** Props for active timeline state. */
  activeTimelineProps?: UseActiveTimelineProps;
}

/**
 * @deprecated Use the options-object overload instead.
 */
export function useTranscriptTimeline(
  events: Event[],
  markerConfig?: MarkerConfig,
  timelineOptions?: TimelineOptions,
  serverTimelines?: ServerTimeline[],
  props?: {
    timelineProps?: UseTimelineProps;
    activeTimelineProps?: UseActiveTimelineProps;
  }
): TranscriptTimelineResult;
export function useTranscriptTimeline(
  options: UseTranscriptTimelineOptions
): TranscriptTimelineResult;
export function useTranscriptTimeline(
  eventsOrOptions: Event[] | UseTranscriptTimelineOptions,
  markerConfigArg?: MarkerConfig,
  timelineOptionsArg?: TimelineOptions,
  serverTimelinesArg?: ServerTimeline[],
  propsArg?: {
    timelineProps?: UseTimelineProps;
    activeTimelineProps?: UseActiveTimelineProps;
  }
): TranscriptTimelineResult {
  // Normalise: support both positional and options-object signatures.
  const opts: UseTranscriptTimelineOptions = Array.isArray(eventsOrOptions)
    ? {
        events: eventsOrOptions,
        markerConfig: markerConfigArg,
        timelineOptions: timelineOptionsArg,
        serverTimelines: serverTimelinesArg,
        timelineProps: propsArg?.timelineProps,
        activeTimelineProps: propsArg?.activeTimelineProps,
      }
    : eventsOrOptions;

  const {
    events,
    markerConfig = defaultMarkerConfig,
    timelineOptions,
    serverTimelines,
    timelineProps,
    activeTimelineProps,
  } = opts;

  const includeUtility = timelineOptions?.includeUtility ?? false;
  const showBranches = timelineOptions?.showBranches ?? false;
  const forkRelative = timelineOptions?.forkRelative ?? false;
  const timelines = useTimelinesArray(events, serverTimelines);

  const {
    active: activeTimeline,
    activeIndex: activeTimelineIndex,
    setActive: setActiveTimeline,
  } = useActiveTimeline(timelines, activeTimelineProps);

  // timelines is always non-empty here (built from events or serverTimelines),
  // so activeTimeline is guaranteed to be defined.
  const timeline = activeTimeline!;

  const state = useTimeline(timeline, timelineOptions, timelineProps);

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
  const branchMappings = useMemo(() => {
    if (!forkRelative || !showBranches) return undefined;
    return computeBranchMappings(visibleRows, timeMapping);
  }, [forkRelative, showBranches, visibleRows, timeMapping]);

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
  const highlightedKeys = useMemo(() => {
    const parsed = parseSelection(state.selected);
    const rowKey = parsed?.rowKey ?? "";
    const row = state.rows.find((r) => r.key === rowKey);
    if (!row?.branch) return emptyHighlightedKeys;

    const layoutByKey = new Map<string, RowLayout>();
    for (const layout of layouts) {
      layoutByKey.set(layout.key, layout);
    }

    const keys = new Map<string, number>();
    keys.set(rowKey, 100);

    let childKey = rowKey;
    while (true) {
      const parentKey = getParentKeyFromBranch(childKey);
      if (!parentKey) break;

      const branchMatch = /\/branch-([^/]*)-\d+$/.exec(childKey);
      const branchedFrom = branchMatch?.[1] ?? "";

      const parentLayout = layoutByKey.get(parentKey);
      const forkMarker = parentLayout?.markers.find(
        (m) => m.kind === "branch" && m.reference === branchedFrom
      );

      keys.set(parentKey, forkMarker?.left ?? 100);
      childKey = parentKey;
    }
    return keys;
  }, [state.selected, state.rows, layouts]);

  const hasTimeline =
    timeline.root.content.length > 0 &&
    (timeline.root.content.some((item) => item.type === "span") ||
      timeline.root.branches.length > 0);

  // Compute the agent name for the outline header.
  // When a swimlane row is selected, show its name; otherwise show the root.
  const outlineAgentName = useMemo(() => {
    if (!state.selected) return timeline.root.name;
    const parsed = parseSelection(state.selected);
    const rowKey = parsed?.rowKey ?? state.selected;
    const row = state.rows.find((r) => r.key === rowKey);
    return row?.name ?? timeline.root.name;
  }, [state.selected, state.rows, timeline.root.name]);

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
    outlineAgentName,
  };
}

// =============================================================================
// Fork-relative branch mapping computation
// =============================================================================

const kBranchKeyPattern = /\/branch-([^/]*)-(\d+)$/;

function computeBranchMappings(
  rows: ReadonlyArray<SwimlaneRow>,
  trunkMapping: TimeMapping
): ReadonlyMap<string, TimeMapping> {
  const mappings = new Map<string, TimeMapping>();

  const rowByKey = new Map<string, SwimlaneRow>();
  for (const row of rows) {
    rowByKey.set(row.key, row);
  }

  for (const row of rows) {
    if (!row.branch || !row.branchedFrom) continue;

    const parentKey = row.key.replace(kBranchKeyPattern, "");
    const parentRow = rowByKey.get(parentKey);
    if (!parentRow) continue;

    const parentFirstSpan = parentRow.spans[0];
    const parentSpan =
      parentRow.spans.length === 1 &&
      parentFirstSpan &&
      isSingleSpan(parentFirstSpan)
        ? parentFirstSpan.agent
        : null;
    if (!parentSpan) continue;

    const branchFirstSpan = row.spans[0];
    const branchSpan =
      row.spans.length === 1 && branchFirstSpan && isSingleSpan(branchFirstSpan)
        ? branchFirstSpan.agent
        : null;
    if (!branchSpan) continue;

    const forkTimestamp = resolveForkTimestamp(parentSpan, branchSpan);

    const parentMapping = mappings.get(parentKey) ?? trunkMapping;
    const forkPercent = parentMapping.toPercent(forkTimestamp);

    mappings.set(
      row.key,
      createShiftedMapping(row.startTime, row.endTime, forkPercent)
    );
  }

  return mappings;
}
