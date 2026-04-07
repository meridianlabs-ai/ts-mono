/**
 * Pure function and type exports from the transcript module.
 * Use this entrypoint in test environments where importing React components
 * would cause module resolution issues (e.g., Jest ESM).
 */

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

// Event utilities (pure functions, no React)
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
