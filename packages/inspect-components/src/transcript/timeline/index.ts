/**
 * Timeline utilities for transcript visualization.
 *
 * Pure algorithmic code — no React or DOM dependencies. Provides the data
 * model (TimelineSpan, TimelineEvent), server-to-client conversion, swimlane
 * row computation, time mapping, layout positioning, and marker collection.
 */

export {
  buildTimeline,
  computeIdleTime,
  convertServerTimeline,
  createBranchSpan,
  getSpanToolResult,
  getUtilityAgentLabel,
  TimelineEvent,
  TimelineSpan,
  type Outline,
  type OutlineNode,
  type Timeline,
} from "./core";

export {
  buildContentItems,
  type AgentCardItem,
  type BranchCardItem,
  type ContentItem,
  type EventItem,
} from "./contentItems";

export {
  collectMarkers,
  defaultMarkerConfig,
  isCompactionEvent,
  isErrorEvent,
  resolveForkTimestamp,
  type MarkerConfig,
  type MarkerDepth,
  type MarkerKind,
  type TimelineMarker,
} from "./markers";

export {
  computeBarPosition,
  computeRowLayouts,
  computeTimeEnvelope,
  formatTokenCount,
  rowHasEvents,
  spanHasEvents,
  timestampToPercent,
  type BarPosition,
  type PositionedMarker,
  type PositionedSpan,
  type RowLayout,
} from "./swimlaneLayout";

export {
  assignToLanes,
  compareByTime,
  computeFlatSwimlaneRows,
  computeSwimlaneRows,
  getAgents,
  isParallelSpan,
  isSingleSpan,
  type ParallelSpan,
  type RowSpan,
  type SingleSpan,
  type SwimlaneRow,
} from "./swimlaneRows";

export {
  computeActiveTime,
  computeTimeMapping,
  createIdentityMapping,
  createShiftedMapping,
  type GapRegion,
  type TimeMapping,
} from "./timeMapping";

export {
  attachSourceSpans,
  buildSelectionKey,
  buildSpanSelectKeys,
  collectBranchWithContext,
  collectRawEvents,
  computeCompactionRegions,
  computeMinimapSelection,
  getBranchPrefix,
  getParentKeyFromBranch,
  getSelectedSpans,
  parseSelection,
  type CollectedEvents,
  type MinimapSelection,
  type ParsedSelection,
  type SpanSelectKey,
} from "./timelineEventNodes";
