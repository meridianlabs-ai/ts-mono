import type { EventType } from "../types";

export const STEP = "step";
export const ACTION_BEGIN = "begin";

export const SPAN_BEGIN = "span_begin";
export const SPAN_END = "span_end";
export const TOOL = "tool";
export const SUBTASK = "subtask";
export const STORE = "store";
export const STATE = "state";

export const TYPE_TOOL = "tool";
export const TYPE_SUBTASK = "subtask";
export const TYPE_SOLVER = "solver";
export const TYPE_SOLVERS = "solvers";
export const TYPE_AGENT = "agent";
export const TYPE_HANDOFF = "handoff";
export const TYPE_SCORERS = "scorers";
export const TYPE_SCORER = "scorer";
export const TYPE_CHECKPOINT = "checkpoint";

/** Span/step events group the rows below them; they are structure, not content. */
export const isStructuralEvent = (event: EventType): boolean =>
  event.event === SPAN_BEGIN ||
  event.event === SPAN_END ||
  event.event === STEP;

export const hasSpans = (events: EventType[]): boolean => {
  return events.some((event: EventType) => event.event === SPAN_BEGIN);
};
