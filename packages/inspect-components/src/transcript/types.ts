import type {
  ApprovalEvent,
  BranchEvent,
  CompactionEvent,
  ErrorEvent,
  InfoEvent,
  InputEvent,
  JsonChange,
  LoggerEvent,
  ModelEvent,
  SampleInitEvent,
  SampleLimitEvent,
  SandboxEvent,
  ScoreEditEvent,
  ScoreEvent,
  SpanBeginEvent,
  SpanEndEvent,
  StateEvent,
  StepEvent,
  StoreEvent,
  SubtaskEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { SPAN_BEGIN, STEP, TYPE_SUBTASK, TYPE_TOOL } from "./transform/utils";

export interface StateManager {
  scope: string;
  getState(): object;
  initializeState(state: object): void;
  applyChanges(changes: JsonChange[]): object;
}

export const kTranscriptCollapseScope = "transcript-collapse";
export const kTranscriptOutlineCollapseScope = "transcript-outline";

export const kCollapsibleEventTypes = [
  STEP,
  SPAN_BEGIN,
  TYPE_TOOL,
  TYPE_SUBTASK,
];

export type EventType =
  | SampleInitEvent
  | SampleLimitEvent
  | StateEvent
  | StoreEvent
  | ModelEvent
  | LoggerEvent
  | InfoEvent
  | StepEvent
  | SubtaskEvent
  | ScoreEvent
  | ScoreEditEvent
  | ToolEvent
  | InputEvent
  | ErrorEvent
  | ApprovalEvent
  | BranchEvent
  | CompactionEvent
  | SandboxEvent
  | SpanBeginEvent
  | SpanEndEvent;

// Define the runtime array of all event type values
export const eventTypeValues = [
  "sample_init",
  "sample_limit",
  "state",
  "store",
  "model",
  "logger",
  "info",
  "step",
  "subtask",
  "score",
  "score_edit",
  "tool",
  "input",
  "error",
  "approval",
  "branch",
  "compaction",
  "sandbox",
  "span_begin",
  "span_end",
] as const;

// Derive the type from the array (replaces the indexed access approach)
export type EventTypeValue = (typeof eventTypeValues)[number];

/**
 * Minimal span info attached to event nodes by timeline processing.
 * Set by scout's `attachSourceSpans()`; undefined in inspect.
 */
export interface EventNodeSpan {
  spanType: string | null;
  name: string;
  description?: string;
}

export class EventNode<T extends EventType = EventType> {
  id: string;
  event: T;
  children: EventNode<EventType>[] = [];
  depth: number;
  /** Timeline span info, attached by app-level processing. */
  sourceSpan?: EventNodeSpan;

  constructor(id: string, event: T, depth: number) {
    this.id = id;
    this.event = event;
    this.depth = depth;
  }
}

/**
 * Props threaded from app-level stores through the virtual list
 * to EventPanel for collapse state and deep-link URL generation.
 */
export interface EventPanelCallbacks {
  onCollapse?: (id: string, collapsed: boolean) => void;
  getCollapsed?: (id: string) => boolean;
  getEventUrl?: (eventId: string) => string | undefined;
  linkingEnabled?: boolean;
}

/**
 * Collapse state and callbacks for transcript and outline scopes.
 * Apps provide scope-specific callbacks so components don't need
 * to know about scope string constants.
 */
export interface TranscriptCollapseState {
  /** Current collapsed node IDs for the transcript event list. */
  transcript?: Record<string, boolean>;
  /** Current collapsed node IDs for the outline. */
  outline?: Record<string, boolean>;
  /** Collapse/expand a single transcript event node. */
  onCollapseTranscript?: (nodeId: string, collapsed: boolean) => void;
  /** Collapse/expand a single outline node. */
  onCollapseOutline?: (nodeId: string, collapsed: boolean) => void;
  /** Bulk-set transcript collapsed state (for collapse-all / expand-all). */
  onSetTranscriptCollapsed?: (ids: Record<string, boolean>) => void;
  /** Bulk-set outline collapsed state (for initialization). */
  onSetOutlineCollapsed?: (ids: Record<string, boolean>) => void;
}

export interface TranscriptEventState {
  selectedNav?: string;
  collapsed?: boolean;
}

export type TranscriptState = Record<string, TranscriptEventState>;

/**
 * Context passed to event view components by the virtual list renderer.
 * Merged from scout (hasToolEvents) and inspect (turnInfo).
 */
export interface EventNodeContext {
  hasToolEvents?: boolean;
  turnInfo?: { turnNumber: number; totalTurns: number };
  /** When true, event views should show inline expansion UX element. (e.g. ModelEventView shows a "Show all messages" toggle for expanding filtered input.) */
  inlineExpansionUX?: boolean;
  /** Per-message labels rendered in the chat label gutter (e.g. scanner citation cites like "M1"). Keyed by `message.id`. */
  messageLabels?: Record<string, string>;
}
