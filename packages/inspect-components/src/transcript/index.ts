// Types
export {
  EventNode,
  eventTypeValues,
  kCollapsibleEventTypes,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
} from "./types";
export type {
  EventNodeContext,
  EventNodeSpan,
  EventPanelCallbacks,
  EventType,
  EventTypeValue,
  StateManager,
  TranscriptEventState,
  TranscriptState,
} from "./types";

// Transform utilities
export { fixupEventStream, kSandboxSignalName } from "./transform/fixups";
export { flatTree } from "./transform/flatten";
export type { TreeNodeVisitor } from "./transform/flatten";
export { transformTree } from "./transform/transform";
export { treeifyEvents } from "./transform/treeify";
export {
  ACTION_BEGIN,
  hasSpans,
  SPAN_BEGIN,
  SPAN_END,
  STATE,
  STEP,
  STORE,
  SUBTASK,
  TOOL,
  TYPE_AGENT,
  TYPE_HANDOFF,
  TYPE_SCORER,
  TYPE_SCORERS,
  TYPE_SOLVER,
  TYPE_SOLVERS,
  TYPE_SUBTASK,
  TYPE_TOOL,
} from "./transform/utils";

// Event utilities
export { eventTitle, formatTiming, formatTitle } from "./event/utils";

// Search text
export { eventSearchText } from "./eventSearchText";

// Outline visitors
export {
  collapseScoring,
  collapseTurns,
  computeTurnMap,
  makeTurns,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
} from "./outline/tree-visitors";
export type { TurnInfo } from "./outline/tree-visitors";

// Event UI components
export { EventPanel } from "./event/EventPanel";
export { EventRow } from "./event/EventRow";
export { EventSection } from "./event/EventSection";
export { EventNav } from "./event/EventNav";
export { EventNavs } from "./event/EventNavs";
export { EventTimingPanel } from "./event/EventTimingPanel";
export { EventProgressPanel } from "./event/EventProgressPanel";

// State components
export { StateDiffView } from "./state/StateDiffView";
export {
  RenderableChangeTypes,
  StoreSpecificRenderableTypes,
  Tool,
  Tools,
} from "./state/StateEventRenderers";

// Hooks
export { useStickyObserver } from "./useStickyObserver";

// Icons
export { TranscriptIcons } from "./icons";

// Context
export {
  TimelineSelectContext,
  useTimelineSelect,
} from "./TimelineSelectContext";
export type { TimelineSelectByIdFn } from "./TimelineSelectContext";

// Event view components
export { ApprovalEventView } from "./ApprovalEventView";
export { BranchEventView } from "./BranchEventView";
export { CompactionEventView } from "./CompactionEventView";
export { ErrorEventView } from "./ErrorEventView";
export { InfoEventView } from "./InfoEventView";
export { InputEventView } from "./InputEventView";
export { LoggerEventView } from "./LoggerEventView";
export { ModelEventView } from "./ModelEventView";
export { SampleInitEventView } from "./SampleInitEventView";
export { SampleLimitEventView } from "./SampleLimitEventView";
export { SandboxEventView } from "./SandboxEventView";
export { ScoreEditEventView } from "./ScoreEditEventView";
export { ScoreEventView } from "./ScoreEventView";
export { SpanEventView } from "./SpanEventView";
export { StateEventView } from "./state/StateEventView";
export { StepEventView } from "./StepEventView";
export { SubtaskEventView } from "./SubtaskEventView";
export { ToolEventView } from "./ToolEventView";

// Score utilities
export { ScoreValue, renderScore } from "./ScoreValue";

// Core components
export {
  TranscriptVirtualList,
  RenderedEventNode,
} from "./TranscriptVirtualList";
export { TranscriptVirtualListComponent } from "./TranscriptVirtualListComponent";

// Outline components
export { TranscriptOutline } from "./outline/TranscriptOutline";
export { OutlineRow, iconForNode, summarizeNode } from "./outline/OutlineRow";
export {
  useOutlineWidth,
  labelForOutlineNode,
} from "./outline/useOutlineWidth";
