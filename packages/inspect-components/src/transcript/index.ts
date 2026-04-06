// Types
export {
  EventNode,
  eventTypeValues,
  kCollapsibleEventTypes,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
} from "./types";
export type {
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
  makeTurns,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
} from "./outline/tree-visitors";
