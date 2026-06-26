import { GridState } from "ag-grid-community";

import {
  ApprovalEvent,
  AttachmentData,
  BranchEvent,
  CompactionEvent,
  ContentDocument,
  ContentImage,
  ContentText,
  ErrorEvent,
  EvalSample,
  EvalSet,
  EventData,
  InfoEvent,
  InputEvent,
  LoggerEvent,
  LogHandle,
  ModelEvent,
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
import type { VirtualListStateSnapshot } from "@tsmono/react/virtual";

import {
  EvalHeader,
  LogDetails,
  PendingSamples,
  SampleSummary,
} from "../client/api/types";

import type { SamplesViewState } from "./samples/list/samplesView";

export interface AppState {
  status: AppStatus;
  nativeFind?: boolean;
  showFind: boolean;
  tabs: {
    workspace: string;
    sample: string;
  };
  dialogs: {
    transcriptFilter: boolean;
    options: boolean;
  };
  scrollPositions: Record<string, number>;
  listPositions: Record<string, VirtualListStateSnapshot>;
  visibleRanges: Record<
    string,
    { startIndex: number; endIndex: number; totalCount: number }
  >;
  collapsed: Record<string, boolean>;
  messages: Record<string, boolean>;
  propertyBags: Record<string, Record<string, unknown>>;
  urlHash?: string;
  initialState?: {
    log: string;
    sample_id?: string;
    sample_epoch?: string;
  };
  rehydrated?: boolean;
  displayMode?: "rendered" | "raw";
  logsSampleView: boolean;
}

export interface DisplayedSample {
  logFile: string;
  sampleId: string | number;
  epoch: number;
}

export interface LogsState {
  logDir?: string;
  absLogDir?: string;
  evalSet?: EvalSet;
  selectedLogFile?: string;
  listing: LogsListing;
  pendingRequests: Map<string, Promise<EvalHeader | null>>;
  dbStats: {
    logCount: number;
    previewCount: number;
    detailsCount: number;
  };
  samplesListState: {
    // samplesPanel is cross-log by nature (lists samples from many logs in
    // a directory); it keeps the single-bucket shape. The single-log view
    // (logViewSamples) is keyed per log file so user customizations in one
    // log don't bleed into another with different scorers / eval config.
    byScope: {
      samplesPanel: {
        columnVisibility: Record<string, boolean>;
        gridState?: GridState;
      };
    };
    /** Per-log TaskSamplesView descriptors keyed by log file path. Missing
     *  entries fall through to the eval-author default and then the
     *  built-in default — see `useSamplesView`. */
    byLog: Record<string, SamplesViewState>;
    displayedSamples?: Array<DisplayedSample>;
    previousSamplesPath?: string;
  };
  flow?: string;
  flowDir?: string;
}

export interface LogsListing {
  filteredCount?: number;
  watchedLogs?: LogHandle[];
  selectedRowIndex?: number | null;
  // AG-Grid state stored independently per scope (Tasks vs Folders, each
  // folder, etc.). Switching between scopes loads that scope's own state;
  // switching back restores it. Keyed by `${mode}::${currentDir}`.
  gridStateByScope: Record<string, GridState>;
  columnVisibility: Record<string, boolean>;
}

export interface SampleHandle {
  id: string | number;
  epoch: number;
  logFile: string;
}

export interface LogState {
  loadedLog?: string;

  selectedSampleHandle?: SampleHandle;
  selectedLogDetails?: LogDetails;
  pendingSampleSummaries?: PendingSamples;

  filter: string;
  filterError?: FilterError;

  selectedScores?: ScoreLabel[];
  scores?: ScoreLabel[];

  filteredSampleCount?: number;
}

export type SampleStatus = "ok" | "loading" | "streaming" | "error";

export interface Progress {
  complete: number;
  total: number;
}

export interface EventFilter {
  filteredTypes: string[];
}

export interface SampleState {
  sample_identifier: SampleHandle | undefined;
  sampleInState: boolean;
  selectedSampleObject?: EvalSample;
  sampleStatus: SampleStatus;
  sampleError: Error | undefined;
  sampleNeedsReload: number;
  eventsCleared: boolean;
  downloadProgress?: Progress;

  visiblePopover?: string;

  // Events and attachments
  runningEvents: Event[];
  collapsedEvents: Record<string, Record<string, boolean>> | null;
  collapsedIdBuckets: Record<string, Record<string, boolean>>;
  collapsedMode: "collapsed" | "expanded" | null;
  eventFilter: EventFilter;

  selectedOutlineId?: string;

  // Timeline swimlane state
  timelineSelected: string | null;
  activeTimelineIndex: number;
}

export type Event =
  | SampleInitEvent
  | SampleLimitEvent
  | BranchEvent
  | CompactionEvent
  | SandboxEvent
  | StateEvent
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

export interface AppStatus {
  // Waiting while loading data, show large form of progress
  loading: number;

  // Background syncing data, show small form of activity
  syncing: boolean;
  error?: Error;
}

export interface CurrentLog {
  name: string;
  contents: LogDetails;
}

export interface Logs {
  log_dir: string;
  files: string[];
}

export interface ScoreLabel {
  name: string;
  scorer: string;
}

export interface SampleFilter {
  value?: string;
  error?: FilterError;
}

export interface FilterError {
  from: number;
  to: number;
  message: string;
  severity: "warning" | "error";
}

export type SampleMode = "none" | "single" | "many";

export interface ContentTool {
  type: "tool";
  content: (ContentImage | ContentText | ContentDocument)[];
}

export interface RunningSampleData {
  events: Map<string, EventData>;
  attachments: Map<string, AttachmentData>;
  summary?: SampleSummary;
}
