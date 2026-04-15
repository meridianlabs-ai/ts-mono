import type { components } from "./generated";

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
export type EventsData = S["EventsData"];

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

export interface ScannerInput {
  input: unknown;
  input_type:
    | "transcript"
    | "event"
    | "events"
    | "message"
    | "messages"
    | "timeline"
    | "timelines";
}
