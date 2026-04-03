// The old codegen used Content for the type of ChatMessageBase.content,
// which is str | list[Content] in Python. inspect-common correctly uses
// Content for just the union of content objects.
import type {
  ChatMessage,
  ContentCitation,
  DocumentCitation,
  EvalLog,
  EvalPlanStep,
  EvalScore,
  Event,
  JsonChange,
  ModelConfig,
  ModelUsage,
  Score,
  ToolInfo,
  UrlCitation,
} from "@tsmono/inspect-common";

// Legacy aliases — work toward eliminating this file entirely.
export type { ModelUsage } from "@tsmono/inspect-common";
export type Citations =
  | (ContentCitation | DocumentCitation | UrlCitation)[]
  | null;
export type Input = string | ChatMessage[];
export type ModelRoles = { [k: string]: ModelConfig } | null;
export type ModelUsageDict = { [k: string]: ModelUsage } | null;
export type ScoresDict = { [k: string]: Score } | null | undefined;
export type ScoreValue =
  | string
  | number
  | boolean
  | (string | number | boolean)[]
  | { [k: string]: string | number | boolean | null };
export type ScoreValueOrUnchanged = ScoreValue;
export type Status = EvalLog["status"];
export type Tools = ToolInfo[];

// Generic record types (were `interface Foo { [k: string]: unknown }`)
export type Arguments1 = Record<string, unknown>;
export type Input5 = Record<string, unknown>;
export type Params2 = Record<string, unknown>;

export type ChatMessageContent = ChatMessage["content"];

// Scalar aliases from old codegen
export type CompletedAt = string | "";
export type EvalId = string;
export type Model = string;
export type RunId = string;
export type StartedAt = string | "";
export type Target = string | string[];
export type Task = string;
export type TaskId = string;
export type TaskVersion = number | string;
export type TotalTime = number | null;
export type Version = number;
export type WorkingTime = number | null;

// Convenience aliases (non-canonical — absent from schema, used by consumers)
export type Events = Event[];
export type ChatMessages = ChatMessage[];
export type EvalScores = EvalScore[];
export type EvalPlanSteps = EvalPlanStep[];
export type ToolInfos = ToolInfo[];
export type JsonChanges = JsonChange[];
