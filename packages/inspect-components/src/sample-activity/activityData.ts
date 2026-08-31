import type {
  Event,
  ModelEvent,
  ScoreEvent,
} from "@tsmono/inspect-common/types";
import { isoToEpoch } from "@tsmono/inspect-common/utils";

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
  approval: "Approvals",
  input: "Inputs",
  interrupt: "Interrupts",
  compaction: "Compactions",
  score: "Scores",
};

export const kCategoryShort: Record<ActivityCategory, string> = {
  error: "error",
  limit: "limit",
  approval: "approval",
  input: "input",
  interrupt: "interrupt",
  compaction: "compact",
  score: "score",
};

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

export interface ContextPoint {
  time: number;
  value: number;
  uuid?: string;
}

export interface CompactionDrop {
  time: number;
  /** tokens_before, falling back to the context value at the drop. */
  before?: number;
  after?: number;
  key: string;
  uuid?: string;
}

export interface ActivitySpan {
  start: number;
  end: number;
  kind: "model" | "tool";
  /** Model name or tool function. */
  label: string;
  failed: boolean;
  /** Open-ended span on a running sample — end extends to "now". */
  pending: boolean;
  retries?: number;
  uuid?: string;
  /** Sub-lane index within a concurrent tool burst; undefined = full row. */
  subLane?: number;
  /** Sub-lane count of the burst this span belongs to (≤ kMaxSubLanes). */
  subLaneCount?: number;
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
}

export interface AgentRow {
  model: string;
  /** Secondary role (e.g. "grader") — rendered muted at 0.7 opacity. */
  role?: string;
  spans: ActivitySpan[];
  bursts: ToolBurst[];
  modelCount: number;
  toolCount: number;
  failedCount: number;
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
  key: string;
  uuid?: string;
  lead: string;
  mono?: string;
  tail?: string;
  detail?: string;
  /** Right-aligned By column ("system", approver, "user"). */
  by: string;
}

export interface ActivityData {
  /** Wall-clock window; undefined when no event carries a timestamp. */
  window?: TimeWindow;
  workingSegments: WorkingSegment[];
  /** Chronological; the chart labels only the N longest. */
  stalls: StallRegion[];
  /** Seconds — sample scalar when present, else summed segments. */
  workingTime: number;
  totalTime: number;
  /** Cumulative total-token step curve (one point per model call). */
  tokenSeries: StepPoint[];
  totalTokens: number;
  /** Per-call input-side tokens at event time. */
  contextSeries: ContextPoint[];
  contextPeak: number;
  compactions: CompactionDrop[];
  agentRows: AgentRow[];
  markers: ActivityMarker[];
  rows: ActivityHistoryRow[];
  /** Any open-ended span (running sample). */
  pending: boolean;
}

// ── formatting (handoff style: "2m 15s", "183k") ─────────────────────────

export const fmtDurationWords = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const t = Math.round(seconds);
  if (t < 60) return `${t}s`;
  if (t < 3600) {
    const m = Math.floor(t / 60);
    const s = t % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

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

// ── search haystack ──────────────────────────────────────────────────────

export const rowHaystack = (row: ActivityHistoryRow): string =>
  [
    kCategoryLong[row.category],
    kCategoryShort[row.category],
    row.lead,
    row.mono ?? "",
    row.tail ?? "",
    row.detail ?? "",
    row.by,
  ].join(" ");

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

const truncate = (text: string, max = 120): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

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

/** Input-side tokens for one model call (context occupancy). */
const inputSideTokens = (event: ModelEvent): number | undefined => {
  const usage = event.output.usage;
  if (!usage) return undefined;
  return (
    usage.input_tokens +
    (usage.input_tokens_cache_read ?? 0) +
    (usage.input_tokens_cache_write ?? 0)
  );
};

/** All tokens for one model call — the burn curve's increment. */
const allTokens = (event: ModelEvent): number | undefined => {
  const usage = event.output.usage;
  if (!usage) return undefined;
  const input = inputSideTokens(event) ?? 0;
  return input + usage.output_tokens;
};

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

/**
 * The single O(n) pass over sample.events producing every band series,
 * stall region, marker, and history row (spec: Architecture).
 */
export const deriveActivityData = (inputs: ActivityInputs): ActivityData => {
  const { events, running = false } = inputs;

  const checkpoints: Checkpoint[] = [];
  const tokenSeries: StepPoint[] = [];
  const contextSeries: ContextPoint[] = [];
  const compactions: CompactionDrop[] = [];
  const markers: ActivityMarker[] = [];
  const rows: ActivityHistoryRow[] = [];
  /** Retry-bearing model-call windows for stall attribution. */
  const retryWindows: {
    start: number;
    end: number;
    retries: number;
    uuid?: string;
  }[] = [];
  const rowsByKey = new Map<string, AgentRow>();
  const agentRows: AgentRow[] = [];

  let minTime = Infinity;
  let maxTime = -Infinity;
  let cumulativeTokens = 0;
  let contextPeak = 0;
  let lastContext = 0;
  let pending = false;
  /** Temporal tool → model-row attribution: the row of the model call that
   *  most recently started. */
  let currentRow: AgentRow | undefined;

  const rowFor = (model: string, role: string | undefined): AgentRow => {
    const key = `${model} ${role ?? ""}`;
    let row = rowsByKey.get(key);
    if (!row) {
      row = {
        model,
        role,
        spans: [],
        bursts: [],
        modelCount: 0,
        toolCount: 0,
        failedCount: 0,
      };
      rowsByKey.set(key, row);
      agentRows.push(row);
    }
    return row;
  };

  // Pre-scan for the time extent so `now` has a fallback before the main
  // pass needs it for open-ended spans.
  for (const event of events) {
    const t = isoToEpoch(event.timestamp);
    if (t !== undefined) {
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    }
    const completed = completedEpoch(event);
    if (completed !== undefined && completed > maxTime) maxTime = completed;
  }
  if (minTime > maxTime) {
    // No event timestamps at all — the caller hides the tab; still return
    // an inert shape so downstream code never branches on undefined arrays.
    return {
      window: undefined,
      workingSegments: [],
      stalls: [],
      workingTime: inputs.workingTime ?? 0,
      totalTime: inputs.totalTime ?? 0,
      tokenSeries: [],
      totalTokens: 0,
      contextSeries: [],
      contextPeak: 0,
      compactions: [],
      agentRows: [],
      markers: [],
      rows: [],
      pending: false,
    };
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

  events.forEach((event, index) => {
    const t = isoToEpoch(event.timestamp);
    if (t === undefined) return;
    const key = event.uuid ?? `evt:${index}`;
    const uuid = event.uuid ?? undefined;

    checkpoints.push({ wall: t, work: event.working_start });
    const completed = completedEpoch(event);
    const workingTime =
      "working_time" in event && typeof event.working_time === "number"
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
        const role = event.role ?? undefined;
        const row = rowFor(event.model, role);
        row.modelCount += 1;
        row.spans.push({
          start: t,
          end,
          kind: "model",
          label: event.model,
          failed: false,
          pending: isPending,
          retries: event.retries ?? undefined,
          uuid,
        });
        // Tool calls that follow attribute to the primary row even when a
        // grader ran in between — grader rows don't call tools.
        if (!role) currentRow = row;
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
          cumulativeTokens += burned;
          tokenSeries.push({ time: completed ?? t, value: cumulativeTokens });
        }
        const context = inputSideTokens(event);
        if (context !== undefined && context > 0) {
          contextSeries.push({ time: t, value: context, uuid });
          lastContext = context;
          if (context > contextPeak) contextPeak = context;
        }
        break;
      }
      case "tool": {
        const failed = event.error != null || event.failed === true;
        const isPending = event.pending === true && completed === undefined;
        const end = completed ?? (isPending ? Math.max(windowEnd, t) : t);
        if (isPending) pending = true;
        const row = currentRow ?? rowFor("tools", undefined);
        row.toolCount += 1;
        if (failed) row.failedCount += 1;
        row.spans.push({
          start: t,
          end,
          kind: "tool",
          label: event.function,
          failed,
          pending: isPending,
          uuid,
        });
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
        markers.push({
          time: t,
          category: "approval",
          key,
          uuid,
          label: `Approval · ${event.call.function} · ${event.decision}`,
        });
        rows.push({
          time: t,
          category: "approval",
          key,
          uuid,
          lead: "Approval requested for",
          mono: event.call.function,
          detail: event.decision,
          by: event.approver,
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
          detail: event.input ? `“${truncate(event.input, 80)}”` : undefined,
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
        const before =
          event.tokens_before ?? (lastContext > 0 ? lastContext : undefined);
        const after = event.tokens_after ?? undefined;
        compactions.push({ time: t, before, after, key, uuid });
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
        if (after !== undefined) lastContext = after;
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
  });

  // ── working segments + stalls from the checkpoint stream ─────────────
  checkpoints.sort((a, b) => a.wall - b.wall || a.work - b.work);
  const workingSegments: WorkingSegment[] = [];
  const stalls: StallRegion[] = [];
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

  // ── per-row concurrent tool bursts → sub-lanes ────────────────────────
  for (const row of agentRows) {
    row.spans.sort((a, b) => a.start - b.start || a.end - b.end);
    assignSubLanes(row);
  }
  // Primary rows first (in first-appearance order), role rows after.
  agentRows.sort((a, b) => {
    const roleRank = (row: AgentRow) => (row.role ? 1 : 0);
    if (roleRank(a) !== roleRank(b)) return roleRank(a) - roleRank(b);
    const first = (row: AgentRow) => row.spans[0]?.start ?? Infinity;
    return first(a) - first(b);
  });

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
    tokenSeries,
    totalTokens: cumulativeTokens,
    contextSeries,
    contextPeak,
    compactions,
    agentRows,
    markers,
    rows,
    pending,
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
      const shown = burst.slice(0, kMaxSubLanes);
      shown.forEach((span, lane) => {
        span.subLane = lane;
        span.subLaneCount = shown.length;
      });
      // Folded spans render nothing individually; the burst label counts
      // them so nothing silently disappears.
      const names = new Map<string, number>();
      let failed = 0;
      for (const span of burst) {
        names.set(span.label, (names.get(span.label) ?? 0) + 1);
        if (span.failed) failed += 1;
      }
      const dominant =
        [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "tools";
      row.bursts.push({
        start: burst[0]?.start ?? 0,
        end: burstEnd,
        count: burst.length,
        failed,
        label: dominant,
        folded: Math.max(0, burst.length - kMaxSubLanes),
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
