import type {
  ChatMessage,
  EvalLog,
  EvalPlanStep,
  EvalSample,
  EvalScore,
  EvalSpec,
  EvalStats,
  Event,
  JsonChange,
  Score,
  ToolInfo,
} from "@tsmono/inspect-common";

// Arrays of inspect types
export type Events = Event[];
export type ChatMessages = ChatMessage[];
export type EvalScores = EvalScore[];
export type EvalPlanSteps = EvalPlanStep[];
export type ToolInfos = ToolInfo[];
export type JsonChanges = JsonChange[];

// Type aliases
export type EvalSpecModelRoles = EvalSpec["model_roles"];
export type EvalStatsModelUsage = EvalStats["model_usage"];
export type EvalSampleScore = EvalSample["scores"];
export type ScoreValue = Score["value"];
export type EvalLogStatus = EvalLog["status"];
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

export type ChatViewToolCallStyle = "compact" | "complete" | "omit";
