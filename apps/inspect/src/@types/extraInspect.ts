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

export type ChatMessageContent = ChatMessage["content"];
export type ChatMessages = ChatMessage[];
export type EvalLogStatus = EvalLog["status"];
export type EvalLogVersion = EvalLog["version"];
export type EvalPlanSteps = EvalPlanStep[];
export type EvalSampleScore = EvalSample["scores"];
export type EvalSampleTarget = EvalSample["target"];
export type EvalSampleWorkingTime = EvalSample["working_time"];
export type EvalScores = EvalScore[];
export type EvalSpecModelRoles = EvalSpec["model_roles"];
export type EvalStatsModelUsage = EvalStats["model_usage"];
export type Events = Event[];
export type JsonChanges = JsonChange[];
export type ScoreValue = Score["value"];
export type ToolInfos = ToolInfo[];
