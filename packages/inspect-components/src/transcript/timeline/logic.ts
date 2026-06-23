// Pure timeline + swimlane layout logic — no React, no CSS, no peer deps.
// Exposed as a subpath so consumers that only need the layout algorithm
// don't have to satisfy the package's UI peerDependencies.

export {
  TimelineEvent,
  TimelineSpan,
  buildTimeline,
  convertServerTimeline,
  filterEmptyBranches,
  isEmptyBranch,
  spanHasBranches,
  createBranchSpan,
  splice,
  spliceToTimeline,
  stripSuffix,
  computeIdleTime,
  getSpanToolResult,
  getUtilityAgentLabel,
  type Timeline,
  type Outline,
  type OutlineNode,
} from "./core";

export {
  computeSwimlaneRows,
  computeFlatSwimlaneRows,
  assignToLanes,
  compareByTime,
  isSingleSpan,
  isParallelSpan,
  getAgents,
  type SwimlaneRow,
  type RowSpan,
  type SingleSpan,
  type ParallelSpan,
} from "./swimlaneRows";

export {
  parseSelection,
  buildSelectionKey,
  getSelectedSpans,
  type MinimapSelection,
} from "./timelineEventNodes";
