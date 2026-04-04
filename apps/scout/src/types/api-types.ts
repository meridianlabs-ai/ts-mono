import type { components } from "./generated";

export type {
  ApprovalEvent,
  BatchConfig,
  BranchEvent,
  CachePolicy,
  ChatMessage,
  ChatMessageAssistant,
  ChatMessageSystem,
  ChatMessageTool,
  ChatMessageUser,
  Citation,
  CompactionEvent,
  Content,
  ContentAudio,
  ContentCitation,
  ContentData,
  ContentDocument,
  ContentImage,
  ContentReasoning,
  ContentText,
  ContentToolUse,
  ContentVideo,
  DocumentCitation,
  ErrorEvent,
  EvalSampleLimit,
  Event,
  EventsData,
  GenerateConfig as GenerateConfigInput,
  InfoEvent,
  InputEvent,
  JsonChange,
  JsonValue,
  LoggerEvent,
  ModelCall,
  ModelConfig,
  ModelEvent,
  ModelUsage,
  SampleInitEvent,
  SampleLimitEvent,
  SandboxEvent,
  Score,
  ScoreEditEvent,
  ScoreEvent,
  SpanBeginEvent,
  SpanEndEvent,
  StateEvent,
  StepEvent,
  StoreEvent,
  SubtaskEvent,
  ToolCallContent,
  ToolCallView,
  ToolChoice,
  ToolEvent,
  ToolFunction,
  ToolInfo,
  UrlCitation,
} from "@tsmono/inspect-common/types";

type S = components["schemas"];

export type ActiveScanInfo = S["ActiveScanInfo"];
export type ActiveScansResponse = S["ActiveScansResponse"];
export type Status = S["Status"];
export type ScanRow = S["ScanRow"];
export type ScanSpec = S["ScanSpec"];
export type ScanJobConfig = S["ScanJobConfig"];
export type Summary = S["Summary"];
export type Error = S["Error"];
export type ScannerSpec = S["ScannerSpec"];
export type ScannerSummary = S["ScannerSummary"];
export type TranscriptsResponse = S["TranscriptsResponse"];
export type Transcript = S["Transcript"];
export type MessagesEventsResponse = S["MessagesEventsResponse"];
export type Pagination = S["Pagination"];
export type TranscriptInfo = S["TranscriptInfo"];
export type ScansResponse = S["ScansResponse"];
export type AppDir = S["AppDir"];
export type ScannerInfo = S["ScannerInfo"];
export type ScannersResponse = S["ScannersResponse"];
export type AppConfig = S["AppConfig"];
export type ProjectConfig = S["ProjectConfig-Output"];
export type ProjectConfigInput = S["ProjectConfig-Input"];
export type InvalidationTopic = S["InvalidationTopic"];
export type RawEncoding = S["RawEncoding"];
export type ScannerInputResponse = S["ScannerInputResponse"];

// Timeline types (server-provided, snake_case)
export type ServerTimeline = S["Timeline"];
export type ServerTimelineSpan = S["TimelineSpan"];
export type ServerTimelineEvent = S["TimelineEvent"];

// Validation types
export type ValidationCase = S["ValidationCase"];
export type ValidationCaseRequest = S["ValidationCaseRequest"];
export type ValidationSetInput = S["ValidationSet-Input"];
export type ValidationSetOutput = S["ValidationSet-Output"];
export type CreateValidationSetRequest = S["CreateValidationSetRequest"];
export type ValidationEntry = S["ValidationEntry"];
export type ValidationMetrics = S["ValidationMetrics"];
export type ValidationResults = S["ValidationResults"];

export type ScannerInput = Omit<ScannerInputResponse, "input_data">;
