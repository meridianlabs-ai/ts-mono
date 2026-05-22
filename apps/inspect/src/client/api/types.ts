import type {
  ApprovalEvent,
  AttachmentData,
  BranchEvent,
  CallPoolData,
  CompactionEvent,
  ErrorEvent,
  EvalError,
  EvalLog,
  EvalMetric,
  EvalPlan,
  EvalResults,
  EvalSample,
  EvalSet,
  EvalSpec,
  EvalStats,
  InfoEvent,
  InputEvent,
  LogFilesResponse,
  LoggerEvent,
  LogHandle,
  LogInfo,
  LogUpdate,
  MessagePoolData,
  ModelEvent,
  ModelUsage,
  SampleInitEvent,
  SampleLimitEvent,
  SandboxEvent,
  ScoreEvent,
  StateEvent,
  StepEvent,
  StoreEvent,
  SubtaskEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import {
  EvalLogStatus,
  EvalLogVersion,
  EvalSampleScore,
  EvalSampleTarget,
} from "../../@types/extraInspect";

export type { CallPoolData, MessagePoolData };

// Hand-coded — references the local EventData with typed event union
export interface SampleData {
  events: EventData[];
  attachments: AttachmentData[];
  message_pool: MessagePoolData[];
  call_pool: CallPoolData[];
}

export type ProgressCallback = (
  bytesLoaded: number,
  bytesTotal: number
) => void;

export interface LogDetails {
  version?: EvalLogVersion;
  status?: EvalLogStatus;
  eval: EvalSpec;
  plan?: EvalPlan;
  results?: EvalResults | null;
  stats?: EvalStats;
  error?: EvalError | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  log_updates?: LogUpdate[] | null;
  sampleSummaries: SampleSummary[];
  // S3 ETag captured at fetch time. Used by the `edit_log` middleware
  // to prime an `If-Match` on the *first* save so concurrent-modification
  // protection covers the initial edit, not just chained edits.
  // Populated for S3-backed .eval logs; undefined for local files and
  // (currently) JSON-format logs.
  etag?: string;
}

export interface PendingSampleResponse {
  pendingSamples?: PendingSamples;
  status: "NotModified" | "NotFound" | "OK";
}

export interface SampleDataResponse {
  sampleData?: SampleData;
  status: "NotModified" | "NotFound" | "OK";
  has_more?: boolean;
}

export interface SegmentRef {
  id: number;
  member_name: string;
  direct_url: string | null;
}

export interface PendingSampleUrls {
  segments: SegmentRef[];
  complete: boolean;
  has_more: boolean;
}

// Client-side types — looser than generated server types because they're
// also constructed locally (from URL params, manifests, etc.)
export interface RunningMetric {
  scorer: string;
  name: string;
  value?: number | null;
  reducer?: string;
  params?: {};
}

export interface PendingSamples {
  metrics?: RunningMetric[];
  samples: SampleSummary[];
  refresh: number;
  etag?: string;
}

export interface SampleSummary {
  uuid?: string;
  id: number | string;
  epoch: number;
  input: EvalSample["input"];
  target: EvalSampleTarget;
  scores: EvalSampleScore | null | undefined;
  error?: string;
  limit?: string;
  metadata?: Record<string, any>;
  completed?: boolean;
  retries?: number;
  // Per-sample timing and token usage; populated by Inspect's Python
  // EvalSampleSummary.summary() and serialized into summaries.json.
  model_usage?: Record<string, ModelUsage>;
  started_at?: string | null;
  completed_at?: string | null;
  total_time?: number | null;
  working_time?: number | null;
}

// Hand-coded — generated EventData.event is JsonValue, losing the
// discriminated union that the client relies on for type-safe event handling.
export interface EventData {
  id: number;
  event_id: string;
  sample_id: string;
  epoch: number;
  event:
    | SampleInitEvent
    | SampleLimitEvent
    | SandboxEvent
    | StateEvent
    | BranchEvent
    | CompactionEvent
    | StoreEvent
    | ModelEvent
    | ToolEvent
    | ApprovalEvent
    | InputEvent
    | ScoreEvent
    | ErrorEvent
    | LoggerEvent
    | InfoEvent
    | StepEvent
    | SubtaskEvent;
}

export interface BasicSampleData {
  id: number | string;
  epoch: number;
  target: EvalSampleTarget;
  scores?: EvalSampleScore | null;
}

export interface Capabilities {
  downloadFiles: boolean;
  downloadLogs: boolean;
  webWorkers: boolean;
  streamSamples: boolean;
  streamSampleData: boolean;
}

export interface LogViewAPI {
  client_events: () => Promise<any[]>;
  get_eval_set: (dir?: string) => Promise<EvalSet | undefined>;
  get_flow: (dir?: string) => Promise<string | undefined>;
  get_log_dir?: () => Promise<string | undefined>;
  get_log_dir_handle?: (log_dir: string | undefined) => string;
  get_logs?: (
    mtime: number,
    clientFileCount: number
  ) => Promise<LogFilesResponse>;
  get_log_root: () => Promise<LogRoot | undefined>;
  get_log_contents: (
    log_file: string,
    // This is the number of MB of the log to fetch. If the log is larger than this, only the header will be returned. If not provided, it always fetches the entire log. Really only user for old JSON logs.
    headerOnly?: number,
    capabilities?: Capabilities
  ) => Promise<LogContents>;
  get_log_info: (log_file: string) => Promise<LogInfo>;
  get_log_bytes: (
    log_file: string,
    start: number,
    end: number
  ) => Promise<Uint8Array>;
  get_log_summary?: (log_file: string) => Promise<LogPreview>;
  get_log_summaries: (log_files: string[]) => Promise<LogPreview[]>;
  log_message: (log_file: string, message: string) => Promise<void>;
  download_file: (
    filename: string,
    filecontents: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>
  ) => Promise<void>;
  download_log?: (log_file: string) => Promise<void>;
  open_log_file: (logFile: string, log_dir: string) => Promise<void>;
  eval_pending_samples?: (
    log_file: string,
    etag?: string
  ) => Promise<PendingSampleResponse>;
  eval_log_sample_data?: (
    log_file: string,
    id: string | number,
    epoch: number,
    last_event?: number,
    last_attachment?: number,
    last_message_pool?: number,
    last_call_pool?: number
  ) => Promise<SampleDataResponse | undefined>;
  // Alternative to eval_log_sample_data that fetches segment zips directly
  // from S3 via presigned URLs. Returns undefined when the server doesn't
  // support this path (missing endpoint, non-S3 buffer); throws on real errors.
  eval_log_sample_data_direct?: (
    log_file: string,
    id: string | number,
    epoch: number,
    last_event?: number,
    last_attachment?: number,
    last_message_pool?: number,
    last_call_pool?: number
  ) => Promise<SampleDataResponse | undefined>;
  // POSTs a LogUpdate (tag/metadata edits + provenance) to the server,
  // which read-modifies-writes the log header. Returns the updated EvalLog
  // along with the new ETag (S3 only) for chained edits.
  edit_log?: (
    log_file: string,
    update: LogUpdate,
    if_match_etag?: string
  ) => Promise<EditLogResult>;
  // Best-effort identity of the user running the view server (git
  // user.name/user.email, falling back to the OS login). Used to prefill
  // the Author field on edit dialogs. Optional — not all backends.
  get_user_info?: () => Promise<UserInfo>;
}

export interface EditLogResult {
  log: EvalLog;
  etag?: string;
}

export interface UserInfo {
  name?: string;
  email?: string;
}

export interface ClientAPI {
  // Basic initialization
  get_log_dir: () => Promise<string | undefined>;

  get_log_dir_handle: (log_dir: string | undefined) => string;

  // List of files
  get_logs: (
    mtime: number,
    clientFileCount: number
  ) => Promise<LogFilesResponse>;

  // Log files retrieval
  // Legacy: Read the files and log directory in a single request
  get_log_root: () => Promise<LogRoot>;

  // Read eval set
  get_eval_set: (dir?: string) => Promise<EvalSet | undefined>;

  // Read flow data
  get_flow: (dir?: string) => Promise<string | undefined>;

  get_log_summaries: (log_files: string[]) => Promise<LogPreview[]>;
  get_log_details: (log_file: string, cached?: boolean) => Promise<LogDetails>;

  // Sample retrieval
  get_log_sample: (
    log_file: string,
    id: string | number,
    epoch: number,
    onProgress?: ProgressCallback
  ) => Promise<EvalSample | undefined>;
  get_log_pending_samples?: (
    log_file: string,
    etag?: string
  ) => Promise<PendingSampleResponse>;
  get_log_sample_data?: (
    log_file: string,
    id: string | number,
    epoch: number,
    last_event?: number,
    last_attachment?: number,
    last_message_pool?: number,
    last_call_pool?: number
  ) => Promise<SampleDataResponse | undefined>;

  // Events
  client_events: () => Promise<string[]>;

  // Logging
  log_message?: (log_file: string, message: string) => Promise<void>;

  // File operations (for the client)
  download_file: (
    file_name: string,
    file_contents: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>
  ) => Promise<void>;
  download_log?: (log_file: string) => Promise<void>;
  open_log_file: (log_file: string, log_dir: string) => Promise<void>;

  // Edit a log's tags / metadata. Optional — only backends that support
  // server-side mutation (today: the view server) expose this.
  edit_log?: (
    log_file: string,
    update: LogUpdate,
    if_match_etag?: string
  ) => Promise<EditLogResult>;
  // Best-effort identity for prefilling provenance.author on edits.
  get_user_info?: () => Promise<UserInfo>;
}

export interface ClientStorage {
  getItem: (name: string) => unknown;
  setItem: (name: string, value: unknown) => void;
  removeItem: (name: string) => void;
}

export interface FetchResponse {
  raw: string;
  parsed: Record<string, any>;
}

export interface EvalHeader {
  version?: EvalLogVersion;
  status?: EvalLogStatus;
  eval: EvalSpec;
  plan?: EvalPlan;
  results?: EvalResults | null;
  stats?: EvalStats;
  error?: EvalError | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  log_updates?: LogUpdate[] | null;
}

export interface LogPreview {
  eval_id: EvalSpec["eval_id"];
  run_id: EvalSpec["run_id"];

  task: EvalSpec["task"];
  task_id: EvalSpec["task_id"];
  task_version: EvalSpec["task_version"];

  version?: EvalLogVersion;
  status?: EvalLogStatus;
  error?: EvalError | null;

  model: EvalSpec["model"];
  model_roles?: Record<string, string> | null;

  started_at?: EvalStats["started_at"];
  completed_at?: EvalStats["completed_at"];

  primary_metric?: EvalMetric;
}

export interface LogRoot {
  logs: LogHandle[];
  log_dir?: string;
  abs_log_dir?: string;
}

export interface LogContents {
  raw: string;
  parsed: EvalLog;
}

export interface LogFilesFetchResponse {
  raw: string;
  parsed: Record<string, LogPreview>;
}

export interface UpdateStateMessage {
  data: {
    type: "updateState";
    url: string;
    sample_id?: string;
    sample_epoch?: string;
  };
}

export interface BackgroundUpdateMessage {
  data: {
    type: "backgroundUpdate";
    url: string;
    log_dir: string;
  };
}
export type HostMessage = UpdateStateMessage | BackgroundUpdateMessage;
