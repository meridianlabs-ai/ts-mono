import type {
  Event,
  ModelEvent,
  ScoreEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";
import { isoToEpoch } from "@tsmono/inspect-common/utils";
import { nullProtoRecord } from "@tsmono/util";

// Direct file imports keep this module React-free (the usage barrel pulls
// in component modules).
import { fmtCompactDuration } from "../usage/timeFormat";
import { usageTotal } from "../usage/tokenTotals";

/** Epoch seconds; same convention as the task timeline. */
export interface TimeWindow {
  start: number;
  end: number;
}

// ── marker / history categories ─────────────────────────────────────────

export type ActivityCategory =
  | "error"
  | "limit"
  | "approval"
  | "input"
  | "interrupt"
  | "compaction"
  | "score";

export const kActivityCategories: ActivityCategory[] = [
  "error",
  "limit",
  "approval",
  "input",
  "interrupt",
  "compaction",
  "score",
];

/** One hue per category — glyphs, stems, pills, and row washes all share it
 *  (handoff design tokens). */
export const kCategoryColor: Record<ActivityCategory, string> = {
  error: "#b04a3c",
  limit: "#8a6d1a",
  approval: "#6b4fa8",
  input: "#1d4f7c",
  interrupt: "#6c757d",
  compaction: "#2b6a94",
  score: "#2f8a52",
};

/** Filter-pill captions (long) and Kind-cell captions (short). */
export const kCategoryLong: Record<ActivityCategory, string> = {
  error: "Errors",
  limit: "Limits",
  approval: "Rejections",
  input: "Inputs",
  interrupt: "Interrupts",
  compaction: "Compactions",
  score: "Scores",
};

export const kCategoryShort: Record<ActivityCategory, string> = {
  error: "error",
  limit: "limit",
  approval: "rejected",
  input: "input",
  interrupt: "interrupt",
  compaction: "compact",
  score: "score",
};

/** Conversation hues, assigned in row order and cycled (handoff 10a);
 *  grader/scorer rows always take kScorerHue. */
export const kAgentHues = ["#3a7bd5", "#d9822b", "#b5537f", "#2f8a52"];
export const kScorerHue = "#6c757d";

// ── derived shapes ───────────────────────────────────────────────────────

export interface WorkingSegment {
  start: number;
  end: number;
}

export interface StallRegion {
  start: number;
  end: number;
  /** Seconds of wall clock with no working-time advance. */
  duration: number;
  /** Adjacent ModelEvent.retries when the stall is retry-attributable. */
  retries?: number;
  /** The attributed model event — the stall row's click-through target. */
  uuid?: string;
}

export interface StepPoint {
  time: number;
  value: number;
}

/** One model call's burn, attributed to its conversation row. */
export interface TokenPoint {
  time: number;
  burned: number;
  rowId: string;
  uuid?: string;
  /** 1-based interleaved turn index (set after the pass). */
  turn?: number;
}

export interface ContextPoint {
  time: number;
  value: number;
  rowId: string;
  uuid?: string;
  /** Change versus the previous point on the same row. */
  delta?: number;
  /** Messages in the call's input — the tooltip's "messages" row. */
  messages?: number;
  turn?: number;
}

export interface CompactionDrop {
  time: number;
  /** The conversation whose context was compacted. */
  rowId: string;
  /** tokens_before, falling back to the context value at the drop. */
  before?: number;
  after?: number;
  /** CompactionEvent.type — the tooltip's "strategy" row. */
  strategy?: string;
  key: string;
  uuid?: string;
}

export interface ActivitySpan {
  start: number;
  end: number;
  kind: "model" | "tool";
  /** Model name or tool function. */
  label: string;
  rowId: string;
  failed: boolean;
  /** Open-ended span on a running sample — end extends to "now". */
  pending: boolean;
  /** Working seconds inside the span (wall duration when the log has no
   *  working clock). Turns mode splits a column by these, never by wall
   *  time: waiting has no extent there. */
  working: number;
  retries?: number;
  uuid?: string;
  /** 1-based interleaved turn index. */
  turn?: number;
  /** The concurrent-tool burst this span belongs to (identity, shared by
   *  every member) — independent of whether it got a visible lane. */
  burst?: ToolBurst;
  /** Sub-lane index within the burst; undefined = full row (no burst) or
   *  folded. */
  subLane?: number;
  /** Sub-lane count of the burst this span belongs to (≤ kMaxSubLanes). */
  subLaneCount?: number;
  /** Burst member beyond the lane cap: drawn only through the burst's +N
   *  fold, never as its own rect (it would paint over the lanes). */
  folded?: boolean;
  /** Tool call that spawned a sub-agent conversation: the row id it handed
   *  off to. The span renders only until that child starts; the blocked
   *  interval takes over as the dotted "awaiting" thread. */
  handoffTo?: string;
  // Tooltip detail (handoff 11b) — model turns:
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  stopReason?: string;
  toolCalls?: string[];
  // — tool calls:
  resultBytes?: number;
  /** First argument (url / cmd / path …) as `key` and ellipsized value. */
  firstArgKey?: string;
  firstArg?: string;
  errorMessage?: string;
}

/** A run of concurrently-overlapping tool spans on one agent row. */
export interface ToolBurst {
  start: number;
  end: number;
  count: number;
  failed: number;
  /** Dominant tool name for the "bash ×3 · 1 failed" label. */
  label: string;
  /** Spans beyond the sub-lane cap folded into the "+N" count. */
  folded: number;
  /** Tool names, for the tooltip's mini list. */
  names: string[];
}

/** A parent conversation waiting on a spawned child: from the child's
 *  span start to its span end (handoff 10a "awaiting researcher"). */
export interface BlockedInterval {
  start: number;
  end: number;
  childId: string;
  childName: string;
}

/** One row per conversation (agent, subtask or solver span); grader and
 *  other role/scorer calls get their own rows (handoff 10a). */
export interface AgentRow {
  /** Conversation key: span id, `role:<role>`, `scorer:<name>` or `root`. */
  id: string;
  /** Display name: span name, role, or the model for the root fallback. */
  name: string;
  /** Latest model seen on the row (a swap inside one span stays here). */
  model: string;
  /** Every model seen on the row, first-appearance order. */
  models: string[];
  /** Secondary role (e.g. "grader") — rendered muted at 0.7 opacity. */
  role?: string;
  hue: string;
  isSubAgent: boolean;
  blockedOn: BlockedInterval[];
  spans: ActivitySpan[];
  bursts: ToolBurst[];
  modelCount: number;
  toolCount: number;
  failedCount: number;
}

/** One model turn and the tool calls it issued — the Turns-axis column
 *  (handoff 8b). Turns from every conversation interleave chronologically. */
export interface TurnColumn {
  /** 1-based. */
  index: number;
  rowId: string;
  start: number;
  end: number;
  model?: ActivitySpan;
  tools: ActivitySpan[];
  /** Working seconds spent on the model call. Derived data for consumers
   *  and the derivation tests: nothing in the chart reads it (the Turns
   *  grid is fixed-width; tooltips read the span's own durations). */
  modelWork: number;
  /** Working seconds spent in tool calls (likewise unread by the chart). */
  toolWork: number;
  /** Non-approve approval decisions inside the turn (ghost slots). */
  rejected: number;
}

export interface ActivityMarker {
  time: number;
  category: ActivityCategory;
  /** History-row link (uuid when present, synthetic otherwise). */
  key: string;
  /** Event uuid — the transcript click-through target. */
  uuid?: string;
  /** Tooltip / aria text. */
  label: string;
}

/** One sentence per row: lead text, optional mono value, optional tail
 *  after the value, muted parenthetical detail. */
export interface ActivityHistoryRow {
  time: number;
  category: ActivityCategory;
  /** Kind-cell caption when it differs from the category's default — the
   *  approval decision word (rejected / escalated / terminated / modified). */
  kind?: string;
  key: string;
  uuid?: string;
  lead: string;
  mono?: string;
  tail?: string;
  detail?: string;
  /** Right-aligned By column ("system", approver, "user"). */
  by: string;
  /** Muted suffix after `by` ("approver" for approval-policy names). */
  byRole?: string;
}

/** Kind-cell caption for a history row. */
export const rowKind = (row: ActivityHistoryRow): string =>
  row.kind ?? kCategoryShort[row.category];

export interface ActivityData {
  /** Wall-clock window; undefined when no event carries a timestamp. */
  window?: TimeWindow;
  workingSegments: WorkingSegment[];
  /** Chronological; the chart labels only the N longest. */
  stalls: StallRegion[];
  /** Seconds — sample scalar when present, else summed segments. */
  workingTime: number;
  totalTime: number;
  /** Time-sorted raw burns, one per model call with usage. */
  tokenPoints: TokenPoint[];
  /** Cumulative total-token step curve across every conversation. */
  tokenSeries: StepPoint[];
  totalTokens: number;
  /** Per-conversation cumulative burn (the chart stacks these). */
  tokensByRow: Record<string, StepPoint[]>;
  tokenTotalsByRow: Record<string, number>;
  /** Per-call input-side tokens at event time, every conversation. */
  contextSeries: ContextPoint[];
  contextPeak: number;
  /** One line per conversation; a sub-agent's starts at its first call. */
  contextByRow: Record<string, ContextPoint[]>;
  contextPeakByRow: Record<string, number>;
  compactions: CompactionDrop[];
  agentRows: AgentRow[];
  turns: TurnColumn[];
  markers: ActivityMarker[];
  rows: ActivityHistoryRow[];
  /** Non-approve approval decisions (the activity headline's "N rejected"). */
  rejectedCount: number;
  /** Any open-ended span (running sample). */
  pending: boolean;
  /** False for mid-vintage logs whose events carry timestamps but no real
   *  working clock (normalizer-filled working_start 0, no working_time) —
   *  the working/waiting band would read as all-waiting, so it hides. */
  hasWorkingSignal: boolean;
}

// ── formatting (handoff style: "2m 15s", "183k") ─────────────────────────

/** fmtCompactDuration with a guard: negative/NaN input is corrupt data. */
export const fmtDurationWords = (seconds: number): string =>
  !Number.isFinite(seconds) || seconds < 0 ? "—" : fmtCompactDuration(seconds);

export const fmtTime = (sec: number): string =>
  new Date(sec * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

export const fmtTimeSec = (sec: number): string =>
  new Date(sec * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

export const fmtDay = (sec: number): string =>
  new Date(sec * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

export const fmtTokens = (value: number): string => {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
};

/** Seconds with one decimal for short spans ("49.2s"), words above 1m. */
export const fmtSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return fmtCompactDuration(seconds);
};

export const fmtBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

// ── search haystack ──────────────────────────────────────────────────────

export const rowHaystack = (row: ActivityHistoryRow): string =>
  [
    kCategoryLong[row.category],
    rowKind(row),
    row.lead,
    row.mono ?? "",
    row.tail ?? "",
    row.detail ?? "",
    row.by,
  ].join(" ");

// ── turn lookup ──────────────────────────────────────────────────────────

/** The turn whose wall extent contains `t`, if any. Turns are sorted by
 *  start; a parent's turn can contain a spawned child's turns, so the
 *  latest-starting match wins (the innermost). */
export const turnAt = (
  turns: TurnColumn[],
  t: number
): TurnColumn | undefined => {
  let match: TurnColumn | undefined;
  for (const turn of turns) {
    if (turn.start > t) break;
    if (t <= turn.end) match = turn;
  }
  return match;
};

/** The first turn starting after `t` (markers between turns snap to it). */
export const turnAfter = (
  turns: TurnColumn[],
  t: number
): TurnColumn | undefined => turns.find((turn) => turn.start > t);

// ── internals ────────────────────────────────────────────────────────────

/** Wall/working checkpoint (epoch seconds, working seconds). */
interface Checkpoint {
  wall: number;
  work: number;
}

/** Gaps shorter than this are timing noise, not waiting. */
const kMinGapSeconds = 1;

/** Sub-lane cap for concurrent tool bursts (handoff decision 4). */
export const kMaxSubLanes = 4;

/** span_begin types that open a conversation (inspect_ai: AGENT_SPAN_TYPE
 *  "agent", subtask(), solver spans). */
const kConversationSpanTypes = new Set(["agent", "subtask", "solver"]);
/** span_begin types under which model calls are scorer/grader work. */
const kScorerSpanTypes = new Set(["scorer", "scorers"]);
/** span_begin types that mean "spawned from a tool call". */
const kSpawnSpanTypes = new Set(["tool", "handoff"]);

const kRootRowId = "root";

const truncate = (text: string, max = 120): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Past-tense caption per non-approve decision (approve is never shown:
 *  with a policy active every tool call produces one — pure noise). */
const kDecisionWord = new Map<string, string>([
  ["approve", "approved"],
  ["reject", "rejected"],
  ["escalate", "escalated"],
  ["terminate", "terminated"],
  ["modify", "modified"],
]);

/** The decision's caption. The decision is log-authored and the enum is
 *  not validated at parse time: a Map lookup (never a plain-object index)
 *  so "__proto__" or "constructor" can't resolve to a builtin, and an
 *  unknown future decision keeps its own word rather than rendering
 *  nothing. Takes `unknown` because the wire value may not be a string. */
const decisionWord = (decision: unknown): string => {
  if (typeof decision !== "string") return "decided";
  return (
    kDecisionWord.get(decision) ?? (decision !== "" ? decision : "decided")
  );
};

const valueText = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

/** The call's arguments as a short mono string: a lone argument shows its
 *  value ("rm -rf build/"), several show `key: value` pairs. */
const callArgsText = (args: Record<string, unknown>): string => {
  const entries = Object.entries(args);
  const text =
    entries.length === 1
      ? valueText(entries[0]![1])
      : entries.map(([key, value]) => `${key}: ${valueText(value)}`).join(", ");
  return truncate(text.replace(/\s+/g, " ").trim(), 60);
};

/** The first argument (url / cmd / path) for the tool tooltip. */
const firstArg = (
  args: Record<string, unknown>
): { key: string; value: string } | undefined => {
  const first = Object.entries(args)[0];
  if (!first) return undefined;
  const text = valueText(first[1]).replace(/\s+/g, " ").trim();
  return text ? { key: first[0], value: truncate(text, 80) } : undefined;
};

/** Byte-ish size of a tool result (string length; content parts summed). */
const resultSize = (result: ToolEvent["result"]): number => {
  if (typeof result === "string") return result.length;
  if (typeof result === "number" || typeof result === "boolean") {
    return String(result).length;
  }
  const parts = Array.isArray(result) ? result : [result];
  let size = 0;
  for (const part of parts) {
    if (part.type === "text") size += part.text.length;
  }
  return size;
};

/** Wall completion for duration-bearing events (model/tool/subtask/sandbox). */
const completedEpoch = (event: Event): number | undefined =>
  "completed" in event && typeof event.completed === "string"
    ? isoToEpoch(event.completed)
    : undefined;

const scoreText = (score: ScoreEvent["score"]): string => {
  const value = score.value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Largest token count this surface accepts per field. The normalizer only
 *  checks that token fields are numbers: a crafted or corrupt log can carry
 *  1e308 (two of which sum to Infinity), Infinity or NaN, and any of those
 *  would poison the cumulative totals and the SVG scale divisions. Above
 *  this bound (or non-finite / negative) a count is corrupt and reads as
 *  missing — the call renders without curves, like one with no usage. */
const kMaxTokenCount = Number.MAX_SAFE_INTEGER;

/** A token count that is safe to accumulate and divide by, else undefined. */
const tokenCount = (value: number | null | undefined): number | undefined =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= kMaxTokenCount
    ? value
    : undefined;

/** Input-side tokens for one model call (context occupancy): the shared
 *  total minus the output side. Summing input + cache categories directly
 *  would double-count on providers whose input_tokens already includes
 *  cached reads (OpenAI) — deriving from usageTotal keeps this surface
 *  consistent with the Usage tab. */
const inputSideTokens = (event: ModelEvent): number | undefined => {
  const usage = event.output.usage;
  if (!usage) return undefined;
  const total = tokenCount(usageTotal(usage));
  const output = tokenCount(usage.output_tokens);
  if (total === undefined || output === undefined) return undefined;
  return Math.max(0, total - output);
};

/** All tokens for one model call — the burn curve's increment. Shares
 *  usageTotal with the Usage tab so the two surfaces always agree. */
const allTokens = (event: ModelEvent): number | undefined => {
  const usage = event.output.usage;
  if (!usage) return undefined;
  return tokenCount(usageTotal(usage));
};

/** The model turn's stop reason and issued tool calls (tooltip "stop"). */
const modelStop = (
  event: ModelEvent
): { stopReason?: string; toolCalls: string[] } => {
  const choice = event.output.choices[0];
  const toolCalls = (choice?.message.tool_calls ?? []).map(
    (call) => call.function
  );
  return { stopReason: choice?.stop_reason, toolCalls };
};

/** span_begin bookkeeping for conversation keying. */
interface SpanInfo {
  id: string;
  parentId?: string;
  name: string;
  type?: string;
  start: number;
  end?: number;
}

/** What a span_id resolves to: the conversation row it belongs to. */
interface Conversation {
  id: string;
  name: string;
  /** "role"/"scorer" rows sort last and take the scorer hue. */
  role?: string;
  /** The conversation's own span (agent/subtask/solver), when keyed by one. */
  span?: SpanInfo;
}

export interface ActivityInputs {
  events: Event[];
  startedAt?: string | null;
  completedAt?: string | null;
  workingTime?: number | null;
  totalTime?: number | null;
  /** Live sample — pending spans render open-ended to `now`. */
  running?: boolean;
  /** Epoch seconds for the open edge; defaults to the latest event time. */
  now?: number;
}

/** True when any event carries a usable timestamp — old logs without them
 *  hide the Activity tab entirely. */
export const hasEventTimestamps = (events: Event[]): boolean =>
  events.some((event) => isoToEpoch(event.timestamp) !== undefined);

const inertData = (inputs: ActivityInputs): ActivityData => ({
  window: undefined,
  workingSegments: [],
  stalls: [],
  workingTime: inputs.workingTime ?? 0,
  totalTime: inputs.totalTime ?? 0,
  tokenPoints: [],
  tokenSeries: [],
  totalTokens: 0,
  tokensByRow: nullProtoRecord(new Map()),
  tokenTotalsByRow: nullProtoRecord(new Map()),
  contextSeries: [],
  contextPeak: 0,
  contextByRow: nullProtoRecord(new Map()),
  contextPeakByRow: nullProtoRecord(new Map()),
  compactions: [],
  agentRows: [],
  turns: [],
  markers: [],
  rows: [],
  rejectedCount: 0,
  pending: false,
  hasWorkingSignal: false,
});

/**
 * The single O(n) pass over sample.events producing every band series,
 * stall region, marker, and history row (spec: Architecture).
 */
export const deriveActivityData = (inputs: ActivityInputs): ActivityData => {
  const { events, running = false } = inputs;

  const checkpoints: Checkpoint[] = [];
  /** Raw per-call burns — sorted by time then accumulated AFTER the pass:
   *  overlapping calls (parallel subagents, concurrent scorers) complete
   *  out of event order, and the step path/hover both consume the series
   *  as time-ordered. */
  const tokenPoints: TokenPoint[] = [];
  const contextSeries: ContextPoint[] = [];
  const compactions: CompactionDrop[] = [];
  const markers: ActivityMarker[] = [];
  const rows: ActivityHistoryRow[] = [];
  const turns: TurnColumn[] = [];
  /** Retry-bearing model-call windows for stall attribution. */
  const retryWindows: {
    start: number;
    end: number;
    retries: number;
    uuid?: string;
  }[] = [];
  const rowsById = new Map<string, AgentRow>();
  const agentRows: AgentRow[] = [];
  /** The latest turn per row — tool calls attribute to it. */
  const currentTurnByRow = new Map<string, TurnColumn>();
  /** The turn that produced each burn/context point. Turns are numbered
   *  after the pass (they interleave across conversations), so the link is
   *  by identity — pre-uuid logs have no other handle. */
  const turnOfPoint = new Map<TokenPoint | ContextPoint, TurnColumn>();

  let minTime = Infinity;
  let maxTime = -Infinity;
  let contextPeak = 0;
  /** Latest context size per conversation — the compaction fallback when
   *  tokens_before is absent (older logs). */
  const lastContextByRow = new Map<string, number>();
  let pending = false;
  let rejectedCount = 0;
  // Mid-vintage logs carry timestamps but predate working_start/working_time
  // (the normalizer fills working_start with 0) — without a real working
  // signal the working/waiting band would render the whole run as waiting.
  const hasWorkingSignal = events.some(
    (event) =>
      ("working_time" in event && typeof event.working_time === "number") ||
      event.working_start > 0
  );

  // ── pre-scan: time extent + span tree ─────────────────────────────────
  // `now` needs a fallback before the main pass reaches open-ended spans,
  // and conversation keying walks span parents that may begin after the
  // events they enclose are logged (tool span_begin follows the ToolEvent
  // in real logs).
  const spans = new Map<string, SpanInfo>();
  for (const event of events) {
    const t = isoToEpoch(event.timestamp);
    if (t !== undefined) {
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    }
    const completed = completedEpoch(event);
    if (completed !== undefined && completed > maxTime) maxTime = completed;
    if (event.event === "span_begin" && t !== undefined) {
      spans.set(event.id, {
        id: event.id,
        parentId: event.parent_id ?? undefined,
        name: event.name,
        type: event.type ?? undefined,
        start: t,
      });
    }
  }
  for (const event of events) {
    if (event.event !== "span_end") continue;
    const span = spans.get(event.id);
    const t = isoToEpoch(event.timestamp);
    if (span && t !== undefined) span.end = t;
  }
  if (minTime > maxTime) {
    // No event timestamps at all — the caller hides the tab; still return
    // an inert shape so downstream code never branches on undefined arrays.
    return inertData(inputs);
  }

  const startEpoch = isoToEpoch(inputs.startedAt);
  const endEpoch = isoToEpoch(inputs.completedAt);
  const now = inputs.now ?? maxTime;
  const windowStart =
    startEpoch !== undefined ? Math.min(startEpoch, minTime) : minTime;
  const windowEnd =
    running && now > maxTime
      ? now
      : endEpoch !== undefined
        ? Math.max(endEpoch, maxTime)
        : maxTime;
  const window: TimeWindow = { start: windowStart, end: windowEnd };

  // ── conversation keying (handoff 10a) ─────────────────────────────────
  // Nearest enclosing agent/subtask/solver span keys the row; scorer spans
  // met first make a scorer row; no span context → the root conversation.
  const conversationCache = new Map<string, Conversation>();
  const rootConversation: Conversation = { id: kRootRowId, name: "" };
  const conversationForSpan = (
    spanId: string | null | undefined
  ): Conversation => {
    if (!spanId) return rootConversation;
    const cached = conversationCache.get(spanId);
    if (cached) return cached;
    let resolved: Conversation = rootConversation;
    let cursor: SpanInfo | undefined = spans.get(spanId);
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      if (
        cursor.type !== undefined &&
        kConversationSpanTypes.has(cursor.type)
      ) {
        resolved = { id: cursor.id, name: cursor.name, span: cursor };
        break;
      }
      if (cursor.type !== undefined && kScorerSpanTypes.has(cursor.type)) {
        resolved = {
          id: `scorer:${cursor.name}`,
          name: cursor.name,
          role: "scorer",
        };
        break;
      }
      cursor = cursor.parentId ? spans.get(cursor.parentId) : undefined;
    }
    conversationCache.set(spanId, resolved);
    return resolved;
  };
  /** Role-bearing model calls (grader etc.) get their own row regardless
   *  of span context (handoff: scorer-role ModelEvents key on the role). */
  const conversationFor = (
    spanId: string | null | undefined,
    role: string | null | undefined
  ): Conversation =>
    role
      ? { id: `role:${role}`, name: role, role }
      : conversationForSpan(spanId);
  /** The conversation the latest model call under each span key resolved
   *  to. Tool, approval and compaction events carry no role, so they
   *  attribute through here: a grader's tools stay on the grader row
   *  instead of splitting off to the scorer span (or root without span
   *  context). */
  const currentConversationBySpan = new Map<string, Conversation>();
  const spanKey = (spanId: string | null | undefined): string => spanId ?? "";
  const conversationForEvent = (
    spanId: string | null | undefined
  ): Conversation =>
    currentConversationBySpan.get(spanKey(spanId)) ??
    conversationForSpan(spanId);

  const rowFor = (conversation: Conversation): AgentRow => {
    let row = rowsById.get(conversation.id);
    if (!row) {
      row = {
        id: conversation.id,
        name: conversation.name,
        model: "",
        models: [],
        role: conversation.role,
        hue: kScorerHue,
        isSubAgent: false,
        blockedOn: [],
        spans: [],
        bursts: [],
        modelCount: 0,
        toolCount: 0,
        failedCount: 0,
      };
      rowsById.set(conversation.id, row);
      agentRows.push(row);
    }
    return row;
  };
  /** Conversation span per row id, for parent/child resolution after the pass. */
  const spanByRowId = new Map<string, SpanInfo>();

  const newTurn = (rowId: string, start: number, end: number): TurnColumn => {
    const turn: TurnColumn = {
      index: 0,
      rowId,
      start,
      end,
      tools: [],
      modelWork: 0,
      toolWork: 0,
      rejected: 0,
    };
    turns.push(turn);
    currentTurnByRow.set(rowId, turn);
    return turn;
  };

  // The main pass runs in timestamp order, not array order: a tool call
  // whose event lands late in the array (parallel subagents, buffered
  // writers) must attach to the model turn that issued it, not to a later
  // one. Ties keep array order; synthetic keys keep the original index so
  // history-row keys stay stable regardless of the sort.
  const ordered: { event: Event; index: number; t: number }[] = [];
  events.forEach((event, index) => {
    const t = isoToEpoch(event.timestamp);
    if (t !== undefined) ordered.push({ event, index, t });
  });
  ordered.sort((a, b) => a.t - b.t || a.index - b.index);

  for (const { event, index, t } of ordered) {
    const key = event.uuid ?? `evt:${index}`;
    const uuid = event.uuid ?? undefined;

    checkpoints.push({ wall: t, work: event.working_start });
    const completed = completedEpoch(event);
    const workingTime =
      "working_time" in event &&
      typeof event.working_time === "number" &&
      Number.isFinite(event.working_time)
        ? event.working_time
        : undefined;
    if (completed !== undefined && workingTime !== undefined) {
      checkpoints.push({
        wall: completed,
        work: event.working_start + workingTime,
      });
    }

    switch (event.event) {
      case "model": {
        const isPending = event.pending === true && completed === undefined;
        const end = completed ?? (isPending ? Math.max(windowEnd, t) : t);
        if (isPending) pending = true;
        const conversation = conversationFor(event.span_id, event.role);
        currentConversationBySpan.set(spanKey(event.span_id), conversation);
        const row = rowFor(conversation);
        if (conversation.span) spanByRowId.set(row.id, conversation.span);
        row.modelCount += 1;
        row.model = event.model;
        if (!row.models.includes(event.model)) row.models.push(event.model);
        const usage = event.output.usage ?? undefined;
        const { stopReason, toolCalls } = modelStop(event);
        const span: ActivitySpan = {
          start: t,
          end,
          kind: "model",
          label: event.model,
          rowId: row.id,
          failed: false,
          pending: isPending,
          working: Math.min(workingTime ?? end - t, end - t),
          retries: event.retries ?? undefined,
          uuid,
          inputTokens: usage ? inputSideTokens(event) : undefined,
          cachedTokens: tokenCount(usage?.input_tokens_cache_read),
          outputTokens: tokenCount(usage?.output_tokens),
          stopReason,
          toolCalls,
        };
        row.spans.push(span);
        const turn = newTurn(row.id, t, end);
        turn.model = span;
        turn.modelWork = span.working;
        if ((event.retries ?? 0) > 0) {
          retryWindows.push({
            start: t,
            end,
            retries: event.retries ?? 0,
            uuid,
          });
        }
        const burned = allTokens(event);
        if (burned !== undefined && burned > 0) {
          const point: TokenPoint = {
            time: completed ?? t,
            burned,
            rowId: row.id,
            uuid,
          };
          tokenPoints.push(point);
          turnOfPoint.set(point, turn);
        }
        const context = inputSideTokens(event);
        if (context !== undefined && context > 0) {
          const point: ContextPoint = {
            time: t,
            value: context,
            rowId: row.id,
            uuid,
            messages: event.input.length,
          };
          contextSeries.push(point);
          turnOfPoint.set(point, turn);
          lastContextByRow.set(row.id, context);
          if (context > contextPeak) contextPeak = context;
        }
        break;
      }
      case "tool": {
        const failed = event.error != null || event.failed === true;
        const isPending = event.pending === true && completed === undefined;
        const end = completed ?? (isPending ? Math.max(windowEnd, t) : t);
        if (isPending) pending = true;
        const conversation = conversationForEvent(event.span_id);
        const row = rowFor(conversation);
        if (conversation.span) spanByRowId.set(row.id, conversation.span);
        row.toolCount += 1;
        if (failed) row.failedCount += 1;
        const span: ActivitySpan = {
          start: t,
          end,
          kind: "tool",
          label: event.function,
          rowId: row.id,
          failed,
          pending: isPending,
          working: Math.min(workingTime ?? end - t, end - t),
          uuid,
          resultBytes: resultSize(event.result),
          firstArgKey: firstArg(event.arguments)?.key,
          firstArg: firstArg(event.arguments)?.value,
          errorMessage: event.error?.message
            ? truncate(event.error.message, 160)
            : undefined,
        };
        row.spans.push(span);
        // Attribute to the row's latest model turn (a tool before any model
        // call on its row — odd but possible — opens a tool-only turn).
        const turn = currentTurnByRow.get(row.id) ?? newTurn(row.id, t, end);
        turn.tools.push(span);
        turn.end = Math.max(turn.end, end);
        turn.toolWork += span.working;
        if (failed) {
          const at = completed ?? t;
          markers.push({
            time: at,
            category: "error",
            key,
            uuid,
            label: `Tool ${event.function} errored`,
          });
          rows.push({
            time: at,
            category: "error",
            key,
            uuid,
            lead: "Tool",
            mono: event.function,
            tail: "errored",
            detail: event.error?.message
              ? truncate(event.error.message)
              : undefined,
            by: "system",
          });
        }
        break;
      }
      case "error": {
        markers.push({
          time: t,
          category: "error",
          key,
          uuid,
          label: `Error · ${truncate(event.error.message, 80)}`,
        });
        rows.push({
          time: t,
          category: "error",
          key,
          uuid,
          lead: "Error",
          detail: truncate(event.error.message),
          by: "system",
        });
        break;
      }
      case "sample_limit": {
        markers.push({
          time: t,
          category: "limit",
          key,
          uuid,
          label: `Sample hit ${event.type} limit`,
        });
        rows.push({
          time: t,
          category: "limit",
          key,
          uuid,
          lead: "Sample hit",
          mono: `${event.type} limit`,
          detail: event.message ? truncate(event.message) : undefined,
          by: "system",
        });
        break;
      }
      case "approval": {
        if (event.decision === "approve") break;
        rejectedCount += 1;
        const word = decisionWord(event.decision);
        const args = callArgsText(event.call.arguments);
        // The rejected call belongs to the conversation's current turn —
        // its ghost slot draws there in Turns mode.
        const conversation = conversationForEvent(event.span_id);
        const turn = currentTurnByRow.get(conversation.id);
        if (turn) {
          turn.rejected += 1;
          turn.end = Math.max(turn.end, t);
        }
        markers.push({
          time: t,
          category: "approval",
          key,
          uuid,
          label: `Tool call ${event.call.function} ${word}`,
        });
        rows.push({
          time: t,
          category: "approval",
          kind: word,
          key,
          uuid,
          lead: "Tool call",
          mono: args ? `${event.call.function}: ${args}` : event.call.function,
          tail: word,
          detail: event.explanation
            ? `“${truncate(event.explanation)}”`
            : undefined,
          by: event.approver,
          byRole: "approver",
        });
        break;
      }
      case "input": {
        markers.push({
          time: t,
          category: "input",
          key,
          uuid,
          label: "Input provided",
        });
        rows.push({
          time: t,
          category: "input",
          key,
          uuid,
          lead: "Input provided",
          detail: event.input
            ? `“${truncate(event.input.replace(/\s+/g, " ").trim(), 80)}”`
            : undefined,
          by: "user",
        });
        break;
      }
      case "interrupt": {
        markers.push({
          time: t,
          category: "interrupt",
          key,
          uuid,
          label: `Interrupted (${event.interrupted})`,
        });
        rows.push({
          time: t,
          category: "interrupt",
          key,
          uuid,
          lead: "Interrupted",
          detail: `${event.interrupted} · ${event.source}`,
          by: event.source === "user_cancel" ? "user" : "system",
        });
        break;
      }
      case "compaction": {
        const rowId = conversationForEvent(event.span_id).id;
        const lastContext = lastContextByRow.get(rowId) ?? 0;
        const before =
          tokenCount(event.tokens_before) ??
          (lastContext > 0 ? lastContext : undefined);
        const after = tokenCount(event.tokens_after);
        compactions.push({
          time: t,
          rowId,
          before,
          after,
          strategy: event.type,
          key,
          uuid,
        });
        markers.push({
          time: t,
          category: "compaction",
          key,
          uuid,
          label:
            before !== undefined && after !== undefined
              ? `Context compacted ${fmtTokens(before)} → ${fmtTokens(after)}`
              : "Context compacted",
        });
        rows.push({
          time: t,
          category: "compaction",
          key,
          uuid,
          lead: "Context compacted",
          mono:
            before !== undefined && after !== undefined
              ? `${fmtTokens(before)} → ${fmtTokens(after)}`
              : undefined,
          detail: "tokens",
          by: "system",
        });
        if (after !== undefined) lastContextByRow.set(rowId, after);
        break;
      }
      case "score": {
        const value = scoreText(event.score);
        markers.push({
          time: t,
          category: "score",
          key,
          uuid,
          label: `Scored ${value}${event.intermediate ? " (intermediate)" : ""}`,
        });
        rows.push({
          time: t,
          category: "score",
          key,
          uuid,
          lead: event.intermediate ? "Scored (intermediate)" : "Scored",
          mono: truncate(value, 40),
          detail: event.scorer ? `scorer ${event.scorer}` : undefined,
          by: "system",
        });
        break;
      }
      default:
        break;
    }
  }

  // ── working segments + stalls from the checkpoint stream ─────────────
  // Skipped entirely without a working signal: mid-vintage logs carry
  // timestamps but no working_start/working_time (the normalizer fills 0),
  // and an all-zero work clock would read as "the whole run was waiting".
  checkpoints.sort((a, b) => a.wall - b.wall || a.work - b.work);
  const workingSegments: WorkingSegment[] = [];
  const stalls: StallRegion[] = [];
  if (!hasWorkingSignal) checkpoints.length = 0;
  const pushWorking = (start: number, end: number) => {
    if (end <= start) return;
    const last = workingSegments[workingSegments.length - 1];
    // Merge blocks that touch (within noise) so the band reads as blocks.
    if (last && start - last.end < kMinGapSeconds) {
      last.end = Math.max(last.end, end);
    } else {
      workingSegments.push({ start, end });
    }
  };

  let prev: Checkpoint | undefined;
  for (const point of checkpoints) {
    const work = point.work;
    if (prev) {
      const wallDelta = point.wall - prev.wall;
      if (wallDelta > 0) {
        // Work-first convention: the worked share of the interval renders
        // from its left edge, waiting fills the remainder as a true gap.
        // The per-pair clamp also absorbs working-clock resets: init-scope
        // events can carry a working_start from a different base (observed
        // in real logs), so a negative or over-wide delta degrades to 0 /
        // wallDelta instead of poisoning a global monotone floor.
        const workDelta = Math.min(Math.max(work - prev.work, 0), wallDelta);
        if (workDelta > 0) pushWorking(prev.wall, prev.wall + workDelta);
        const gap = wallDelta - workDelta;
        if (gap >= kMinGapSeconds) {
          const gapStart = prev.wall + workDelta;
          const attributed = retryWindows.find(
            (w) => gapStart < w.end && point.wall > w.start
          );
          stalls.push({
            start: gapStart,
            end: point.wall,
            duration: gap,
            retries: attributed?.retries,
            uuid: attributed?.uuid,
          });
        }
      }
    } else if (
      point.wall > windowStart &&
      point.work >= point.wall - windowStart
    ) {
      // Work before the first checkpoint is real (working_start covers it).
      pushWorking(windowStart, point.wall);
    }
    prev = { wall: point.wall, work };
  }
  // A running sample keeps working past its last checkpoint — open-ended.
  if (running && prev && windowEnd > prev.wall) {
    pushWorking(prev.wall, windowEnd);
  }

  // Attributable stalls become history rows (handoff mock: the rate-limit
  // stall reads as an error row; unattributed waits stay chart-only).
  for (const stall of stalls) {
    if (stall.retries === undefined || stall.retries <= 0) continue;
    rows.push({
      time: stall.start,
      category: "error",
      key: `stall:${stall.start}`,
      uuid: stall.uuid,
      lead: `Model request rate-limited, retried ×${stall.retries}`,
      detail: `resumed after ${fmtDurationWords(stall.duration)}`,
      by: "system",
    });
  }

  // ── rows: names, order, hues, parent/child ────────────────────────────
  for (const row of agentRows) {
    if (!row.name) row.name = row.model || "tools";
    row.spans.sort((a, b) => a.start - b.start || a.end - b.end);
    assignSubLanes(row);
  }
  // Primary rows first (in first-appearance order), role/scorer rows after.
  const firstStart = (row: AgentRow) => row.spans[0]?.start ?? Infinity;
  agentRows.sort((a, b) => {
    const roleRank = (row: AgentRow) => (row.role ? 1 : 0);
    if (roleRank(a) !== roleRank(b)) return roleRank(a) - roleRank(b);
    return firstStart(a) - firstStart(b);
  });
  let hueIndex = 0;
  for (const row of agentRows) {
    row.hue = row.role
      ? kScorerHue
      : kAgentHues[hueIndex++ % kAgentHues.length]!;
  }
  // A conversation nested inside another conversation that has its own row
  // is a sub-agent; its parent waits on it for the child span's extent.
  for (const row of agentRows) {
    const own = spanByRowId.get(row.id);
    if (!own) continue;
    let spawned = false;
    let parentRow: AgentRow | undefined;
    let cursor: SpanInfo | undefined = own.parentId
      ? spans.get(own.parentId)
      : undefined;
    const visited = new Set<string>([own.id]);
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      if (cursor.type !== undefined && kSpawnSpanTypes.has(cursor.type)) {
        spawned = true;
      }
      const candidate = rowsById.get(cursor.id);
      if (candidate && candidate !== row) {
        parentRow = candidate;
        break;
      }
      cursor = cursor.parentId ? spans.get(cursor.parentId) : undefined;
    }
    if (!parentRow) continue;
    row.isSubAgent = true;
    const childStart = own.start;
    const childEnd =
      own.end ??
      (running
        ? windowEnd
        : Math.max(childStart, ...row.spans.map((span) => span.end)));
    // The parent's tool call covering the child's start is the hand-off:
    // it renders up to the child's start, the dotted thread takes over.
    const spawnSpan = spawned
      ? parentRow.spans.find(
          (span) =>
            span.kind === "tool" &&
            span.start <= childStart &&
            span.end >= childStart
        )
      : undefined;
    if (spawnSpan) spawnSpan.handoffTo = row.id;
    if (childEnd > childStart) {
      parentRow.blockedOn.push({
        start: childStart,
        end: childEnd,
        childId: row.id,
        childName: row.name,
      });
    }
  }
  for (const row of agentRows) {
    row.blockedOn.sort((a, b) => a.start - b.start);
  }

  // ── turns: interleave every conversation chronologically ─────────────
  turns.sort((a, b) => a.start - b.start || a.end - b.end);
  turns.forEach((turn, i) => {
    turn.index = i + 1;
    if (turn.model) turn.model.turn = turn.index;
    for (const tool of turn.tools) tool.turn = turn.index;
    // A hand-off tool's working time is the child's run, not the parent's
    // own work — its share stops where the child starts. The turn's tool
    // work is the sum of its spans' so the chart's slot weights add up.
    for (const tool of turn.tools) {
      if (!tool.handoffTo) continue;
      const blocked = rowsById
        .get(turn.rowId)
        ?.blockedOn.find((b) => b.childId === tool.handoffTo);
      if (blocked) {
        tool.working = Math.min(
          tool.working,
          Math.max(0, blocked.start - tool.start)
        );
      }
    }
    turn.toolWork = turn.tools.reduce((sum, tool) => sum + tool.working, 0);
  });

  // ── token burn: total + per-row cumulative ────────────────────────────
  // Overlapping calls complete out of event order — sort the raw burns by
  // time, then accumulate.
  // Row ids are log-authored span ids: built through Maps and exposed as
  // null-prototype records so an id such as "constructor" or "__proto__"
  // never resolves to an inherited builtin (#621).
  tokenPoints.sort((a, b) => a.time - b.time);
  let cumulativeTokens = 0;
  const tokenSeries: StepPoint[] = [];
  const tokensByRow = new Map<string, StepPoint[]>();
  const tokenTotalsByRow = new Map<string, number>();
  for (const point of tokenPoints) {
    point.turn = turnOfPoint.get(point)?.index;
    cumulativeTokens += point.burned;
    tokenSeries.push({ time: point.time, value: cumulativeTokens });
    const rowTotal = (tokenTotalsByRow.get(point.rowId) ?? 0) + point.burned;
    tokenTotalsByRow.set(point.rowId, rowTotal);
    let rowPoints = tokensByRow.get(point.rowId);
    if (!rowPoints) tokensByRow.set(point.rowId, (rowPoints = []));
    rowPoints.push({ time: point.time, value: rowTotal });
  }

  // ── context: per-row lines, deltas, peaks ─────────────────────────────
  contextSeries.sort((a, b) => a.time - b.time);
  const contextByRow = new Map<string, ContextPoint[]>();
  const contextPeakByRow = new Map<string, number>();
  for (const point of contextSeries) {
    point.turn = turnOfPoint.get(point)?.index;
    let rowPoints = contextByRow.get(point.rowId);
    if (!rowPoints) contextByRow.set(point.rowId, (rowPoints = []));
    const previous = rowPoints[rowPoints.length - 1];
    if (previous) point.delta = point.value - previous.value;
    rowPoints.push(point);
    contextPeakByRow.set(
      point.rowId,
      Math.max(contextPeakByRow.get(point.rowId) ?? 0, point.value)
    );
  }

  markers.sort((a, b) => a.time - b.time);
  rows.sort((a, b) => a.time - b.time);

  const totalTime = inputs.totalTime ?? Math.max(0, windowEnd - windowStart);
  const workingTime =
    inputs.workingTime ??
    workingSegments.reduce((sum, s) => sum + (s.end - s.start), 0);

  return {
    window,
    workingSegments,
    stalls,
    workingTime,
    totalTime,
    tokenPoints,
    tokenSeries,
    totalTokens: cumulativeTokens,
    tokensByRow: nullProtoRecord(tokensByRow),
    tokenTotalsByRow: nullProtoRecord(tokenTotalsByRow),
    contextSeries,
    contextPeak,
    contextByRow: nullProtoRecord(contextByRow),
    contextPeakByRow: nullProtoRecord(contextPeakByRow),
    compactions,
    agentRows,
    turns,
    markers,
    rows,
    rejectedCount,
    pending,
    hasWorkingSignal,
  };
};

/** Splits overlapping tool spans into thin sub-lanes for the overlap
 *  duration only (handoff 5a), capping at kMaxSubLanes with a "+N" fold. */
const assignSubLanes = (row: AgentRow): void => {
  const tools = row.spans.filter((span) => span.kind === "tool");
  let burst: ActivitySpan[] = [];
  let burstEnd = -Infinity;

  const flush = () => {
    if (burst.length > 1) {
      const names = new Map<string, number>();
      let failed = 0;
      for (const span of burst) {
        names.set(span.label, (names.get(span.label) ?? 0) + 1);
        if (span.failed) failed += 1;
      }
      const dominant =
        [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "tools";
      const record: ToolBurst = {
        start: burst[0]?.start ?? 0,
        end: burstEnd,
        count: burst.length,
        failed,
        label: dominant,
        folded: Math.max(0, burst.length - kMaxSubLanes),
        names: burst.map((span) => span.label),
      };
      row.bursts.push(record);
      // Every member knows its burst; only the first kMaxSubLanes get a
      // lane. Folded spans render nothing individually — the burst label's
      // +N counts them so nothing silently disappears.
      const shown = Math.min(burst.length, kMaxSubLanes);
      burst.forEach((span, lane) => {
        span.burst = record;
        if (lane < shown) {
          span.subLane = lane;
          span.subLaneCount = shown;
        } else {
          span.folded = true;
        }
      });
    }
    burst = [];
    burstEnd = -Infinity;
  };

  for (const span of tools) {
    if (burst.length > 0 && span.start < burstEnd) {
      burst.push(span);
      burstEnd = Math.max(burstEnd, span.end);
    } else {
      flush();
      burst = [span];
      burstEnd = span.end;
    }
  }
  flush();
};
