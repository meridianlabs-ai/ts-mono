import type {
  ActiveScansResponse,
  AppConfig,
  MessagesEventsResponse,
  ModelEvent,
  ProjectConfig,
  ScanRow,
  ScansResponse,
  ServerTimeline,
  ServerTimelineSpan,
  Status,
  TranscriptInfo,
  TranscriptsResponse,
} from "../../src/types/api-types";

export function createAppConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    home_dir: "/home/test",
    project_dir: "/home/test/project",
    filter: [],
    scans: { dir: "/home/test/project/.scans", source: "project" },
    transcripts: {
      dir: "/home/test/project/.transcripts",
      source: "project",
    },
    ...overrides,
  } satisfies AppConfig;
}

export function createTranscriptInfo(
  overrides: Partial<TranscriptInfo> & { transcript_id: string }
): TranscriptInfo {
  return {
    metadata: {},
    ...overrides,
  };
}

export function createScanRow(
  overrides: Partial<ScanRow> & { scan_id: string }
): ScanRow {
  return {
    location: `/scans/${overrides.scan_id}`,
    packages: {},
    scan_name: overrides.scan_id,
    scanners: "",
    status: "complete",
    tags: "",
    timestamp: "2024-01-01T00:00:00Z",
    total_errors: 0,
    total_results: 0,
    total_tokens: 0,
    transcript_count: 0,
    ...overrides,
  };
}

export function createTranscriptsResponse(
  items: TranscriptInfo[] = []
): TranscriptsResponse {
  return {
    items,
    next_cursor: null,
    total_count: items.length,
  } satisfies TranscriptsResponse;
}

export function createScansResponse(items: ScanRow[] = []): ScansResponse {
  return {
    items,
    next_cursor: null,
    total_count: items.length,
  } satisfies ScansResponse;
}

export function createActiveScansResponse(): ActiveScansResponse {
  return {
    items: {},
  } satisfies ActiveScansResponse;
}

export function createProjectConfig(): ProjectConfig {
  return {
    filter: [],
  } satisfies ProjectConfig;
}

export function createStatus(overrides?: Partial<Status>): Status {
  return {
    complete: true,
    errors: [],
    location: "/home/test/project/.scans/scan_id=aBcDeFgHiJkLmNoPqRsTuV",
    spec: {
      scan_id: "aBcDeFgHiJkLmNoPqRsTuV",
      scan_name: "eval-safety",
      options: { max_transcripts: 25 },
      packages: {},
      scanners: {},
      timestamp: "2024-01-01T00:00:00Z",
    },
    summary: { complete: true, scanners: {} },
    ...overrides,
  } satisfies Status;
}

export function createMessagesEventsResponse(
  overrides?: Partial<MessagesEventsResponse>
): MessagesEventsResponse {
  return {
    messages: [],
    events: [],
    timelines: [],
    ...overrides,
  } satisfies MessagesEventsResponse;
}

// ---------------------------------------------------------------------------
// Timeline factories
// ---------------------------------------------------------------------------

const BASE_TIME = "2025-01-15T10:00:00Z";
const BASE_MS = new Date(BASE_TIME).getTime();

function isoOffset(seconds: number): string {
  return new Date(BASE_MS + seconds * 1000).toISOString();
}

/** Create a minimal ModelEvent with timestamps and tokens. */
export function createModelEvent(options: {
  uuid: string;
  startSec: number;
  endSec: number;
  tokens?: number;
  content?: string;
  spanId?: string;
}): ModelEvent {
  const tokens = options.tokens ?? 100;
  return {
    event: "model",
    uuid: options.uuid,
    model: "claude-sonnet-4-5-20250929",
    input: [],
    tools: [],
    tool_choice: "auto",
    config: {},
    output: {
      choices: [
        {
          message: {
            role: "assistant",
            content: options.content ?? "Response text",
            id: null,
          },
          stop_reason: "stop",
        },
      ],
      completion: options.content ?? "Response text",
      model: "claude-sonnet-4-5-20250929",
      usage: {
        input_tokens: Math.floor(tokens * 0.6),
        output_tokens: Math.floor(tokens * 0.4),
        total_tokens: tokens,
      },
    },
    timestamp: isoOffset(options.startSec),
    completed: isoOffset(options.endSec),
    working_start: options.startSec,
    working_time: options.endSec - options.startSec,
    span_id: options.spanId ?? null,
  };
}

/** Create a ServerTimelineSpan for use in timeline test data. */
export function createTimelineSpan(
  overrides: Partial<ServerTimelineSpan> & { id: string; name: string }
): ServerTimelineSpan {
  return {
    type: "span",
    utility: false,
    content: [],
    branches: [],
    ...overrides,
  };
}

/** Create a ServerTimeline wrapping a root span. */
export function createTimeline(
  root: ServerTimelineSpan,
  name = "Default",
  description = "Test timeline"
): ServerTimeline {
  return { name, description, root };
}

/**
 * Build a complete MessagesEventsResponse with a multi-row timeline.
 *
 * Structure:
 *   Transcript (root)
 *   ├── Explore  (1 model event)
 *   └── Build    (1 model event, optionally with a branch)
 */
export function createTimelineScenario(options?: {
  withBranch?: boolean;
}): MessagesEventsResponse {
  const evt1 = createModelEvent({
    uuid: "evt-explore-1",
    startSec: 2,
    endSec: 5,
    tokens: 200,
    content: "Exploring the codebase",
    spanId: "explore",
  });
  const evt2 = createModelEvent({
    uuid: "evt-build-1",
    startSec: 8,
    endSec: 14,
    tokens: 400,
    content: "Building the feature",
    spanId: "build",
  });

  const events: ModelEvent[] = [evt1, evt2];

  const exploreSpan = createTimelineSpan({
    id: "explore",
    name: "Explore",
    span_type: "agent",
    content: [{ type: "event", event: "evt-explore-1" }],
  });

  const buildSpan = createTimelineSpan({
    id: "build",
    name: "Build",
    span_type: "agent",
    content: [{ type: "event", event: "evt-build-1" }],
  });

  if (options?.withBranch) {
    const branchEvt = createModelEvent({
      uuid: "evt-branch-1",
      startSec: 10,
      endSec: 12,
      tokens: 150,
      content: "Branch attempt",
      spanId: "branch-1",
    });
    events.push(branchEvt);
    buildSpan.branches = [
      createTimelineSpan({
        id: "branch-1",
        name: "Branch Attempt",
        span_type: "branch",
        branched_from: "evt-build-1",
        content: [{ type: "event", event: "evt-branch-1" }],
      }),
    ];
  }

  const rootSpan = createTimelineSpan({
    id: "transcript",
    name: "Transcript",
    span_type: "agent",
    content: [exploreSpan, buildSpan],
  });

  return createMessagesEventsResponse({
    messages: [
      { role: "user", content: "Help me refactor this code" },
    ],
    events,
    timelines: [createTimeline(rootSpan)],
  });
}
