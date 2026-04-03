import {
  ApprovalEvent,
  BranchEvent,
  CompactionEvent,
  ErrorEvent,
  InfoEvent,
  InputEvent,
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

import { JsonChanges } from "../../../@types/bogusTypes";

import { SPAN_BEGIN, STEP, TYPE_SUBTASK, TYPE_TOOL } from "./transform/utils";

export interface StateManager {
  scope: string;
  getState(): object;
  initializeState(state: object): void;
  applyChanges(changes: JsonChanges): object;
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
  | BranchEvent
  | CompactionEvent
  | InfoEvent
  | StepEvent
  | SubtaskEvent
  | ScoreEvent
  | ScoreEditEvent
  | ToolEvent
  | InputEvent
  | ErrorEvent
  | ApprovalEvent
  | SandboxEvent
  | SpanBeginEvent
  | SpanEndEvent;

export class EventNode<T extends EventType = EventType> {
  id: string;
  event: T;
  children: EventNode<EventType>[] = [];
  depth: number;

  constructor(id: string, event: T, depth: number) {
    this.id = id;
    this.event = event;
    this.depth = depth;
  }
}

export interface TranscriptEventState {
  selectedNav?: string;
  collapsed?: boolean;
}

export type TranscriptState = Record<string, TranscriptEventState>;
