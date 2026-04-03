/**
 * Canonical inspect_ai TypeScript types.
 *
 * Plucks named types from generated.ts (produced by openapi-typescript from
 * inspect-openapi.json) and re-exports them as the public API.
 *
 * Noneable fields are `field?: T | null` — the `?` reflects that inspect_ai
 * serializes with `exclude_none=True`, so these fields may be absent at
 * runtime.
 *
 * See design/type-generation-pipeline.md in the inspect_ai repo for the
 * full pipeline.
 */
import type { components } from "./generated";

type S = components["schemas"];

// Core types
export type EvalLog = S["EvalLog"];
export type EvalSet = S["EvalSet"];
export type EvalSetTask = S["EvalSetTask"];
export type EvalConfig = S["EvalConfig"];
export type EvalDataset = S["EvalDataset"];
export type EvalError = S["EvalError"];
export type EvalMetric = S["EvalMetric"];
export type EvalMetricDefinition = S["EvalMetricDefinition"];
export type EvalPlan = S["EvalPlan"];
export type EvalPlanStep = S["EvalPlanStep"];
export type EvalResults = S["EvalResults"];
export type EvalRevision = S["EvalRevision"];
export type EvalSample = S["EvalSample"];
export type EvalSampleLimit = S["EvalSampleLimit"];
export type EvalSampleLimitType = S["EvalSampleLimitType"];
export type EvalSampleReductions = S["EvalSampleReductions"];
export type EvalSampleScore = S["EvalSampleScore"];
export type EvalScore = S["EvalScore"];
export type EvalScorer = S["EvalScorer"];
export type EvalSpec = S["EvalSpec"];
export type EvalStats = S["EvalStats"];

// Event types
export type Event = S["Event"];
export type EventsData = S["EventsData"];
export type ApprovalEvent = S["ApprovalEvent"];
export type BranchEvent = S["BranchEvent"];
export type CompactionEvent = S["CompactionEvent"];
export type ErrorEvent = S["ErrorEvent"];
export type InfoEvent = S["InfoEvent"];
export type InputEvent = S["InputEvent"];
export type LoggerEvent = S["LoggerEvent"];
export type ModelEvent = S["ModelEvent"];
export type SampleInitEvent = S["SampleInitEvent"];
export type SampleLimitEvent = S["SampleLimitEvent"];
export type SandboxEvent = S["SandboxEvent"];
export type ScoreEvent = S["ScoreEvent"];
export type ScoreEditEvent = S["ScoreEditEvent"];
export type SpanBeginEvent = S["SpanBeginEvent"];
export type SpanEndEvent = S["SpanEndEvent"];
export type StateEvent = S["StateEvent"];
export type StepEvent = S["StepEvent"];
export type StoreEvent = S["StoreEvent"];
export type SubtaskEvent = S["SubtaskEvent"];
export type ToolEvent = S["ToolEvent"];

// Chat message types
export type ChatMessage = S["ChatMessage"];
export type ChatMessageAssistant = S["ChatMessageAssistant"];
export type ChatMessageSystem = S["ChatMessageSystem"];
export type ChatMessageTool = S["ChatMessageTool"];
export type ChatMessageUser = S["ChatMessageUser"];

// Content types
export type Citation = S["Citation"];
export type Content = S["Content"];
export type ContentAudio = S["ContentAudio"];
export type ContentAudioFormat = S["ContentAudioFormat"];
export type ContentCitation = S["ContentCitation"];
export type ContentData = S["ContentData"];
export type ContentDocument = S["ContentDocument"];
export type ContentImage = S["ContentImage"];
export type ContentReasoning = S["ContentReasoning"];
export type ContentText = S["ContentText"];
export type ContentToolUse = S["ContentToolUse"];
export type ContentVideo = S["ContentVideo"];
export type ContentVideoFormat = S["ContentVideoFormat"];

// Model types
export type ModelCall = S["ModelCall"];
export type ModelConfig = S["ModelConfig"];
export type ModelOutput = S["ModelOutput"];
export type ModelUsage = S["ModelUsage"];
export type ChatCompletionChoice = S["ChatCompletionChoice"];
export type Logprob = S["Logprob"];
export type Logprobs = S["Logprobs"];
export type TopLogprob = S["TopLogprob"];

// Tool types
export type ToolCall = S["ToolCall"];
export type ToolCallContent = S["ToolCallContent"];
export type ToolCallError = S["ToolCallError"];
export type ToolCallView = S["ToolCallView"];
export type ToolChoice = S["ToolChoice"];
export type ToolFunction = S["ToolFunction"];
export type ToolInfo = S["ToolInfo"];
export type ToolParams = S["ToolParams"];

// Score types
export type Score = S["Score"];
export type ScoreEdit = S["ScoreEdit"];

// Timeline types
export type Timeline = S["Timeline"];
export type TimelineEvent = S["TimelineEvent"];
export type TimelineSpan = S["TimelineSpan"];

// Config types
export type BatchConfig = S["BatchConfig"];
export type CachePolicy = S["CachePolicy"];
export type GenerateConfig = S["GenerateConfig"];
export type ResponseSchema = S["ResponseSchema"];
export type JSONSchema = S["JSONSchema"];
export type ApprovalPolicyConfig = S["ApprovalPolicyConfig"];
export type ApproverPolicyConfig = S["ApproverPolicyConfig"];

// Other types
export type JsonChange = S["JsonChange"];
export type JsonChangeOp = S["JsonChangeOp"];
export type JsonValue = S["JsonValue"];
export type LogUpdate = S["LogUpdate"];
export type LoggingMessage = S["LoggingMessage"];
export type MetadataEdit = S["MetadataEdit"];
export type TagsEdit = S["TagsEdit"];
export type Sample = S["Sample"];
export type SandboxEnvironmentSpec = S["SandboxEnvironmentSpec"];
export type DocumentCitation = S["DocumentCitation"];
export type DocumentRange = S["DocumentRange"];
export type UrlCitation = S["UrlCitation"];
export type ImageOutput = S["ImageOutput"];
export type ProvenanceData = S["ProvenanceData"];
export type EarlyStop = S["EarlyStop"];
export type EarlyStoppingSummary = S["EarlyStoppingSummary"];
export type Outline = S["Outline"];
export type OutlineNode = S["OutlineNode"];
