/**
 * Re-export all transcript types from the shared package.
 *
 * Scout-specific code (AgentCardView, useEventNodes, timeline) imports from
 * here so that a single import path covers both shared and local types.
 */
export {
  EventNode,
  eventTypeValues,
  kCollapsibleEventTypes,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
} from "@tsmono/inspect-components/transcript";
export type {
  EventNodeContext,
  EventNodeSpan,
  EventType,
  EventTypeValue,
  StateManager,
  TranscriptEventState,
  TranscriptState,
} from "@tsmono/inspect-components/transcript";
