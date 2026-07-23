import {
  ConfigUpdate,
  ConfigValueChange,
  ConnectionLimitChange,
  EarlyStoppingSummary,
  EvalConfig,
  EvalStats,
  LogUpdate,
} from "@tsmono/inspect-common/types";
import { formatConfigValue, isoToEpoch } from "@tsmono/inspect-common/utils";

import { EvalLogStatus } from "../../../../@types/extraInspect";
import { SampleSummary } from "../../../../client/api/types";

/** Epoch seconds; timeline math shares the connection-history convention. */
export interface TimeWindow {
  start: number;
  end: number;
}

export type SampleStatus = "completed" | "error" | "limit" | "incomplete";

export const sampleStatus = (sample: SampleSummary): SampleStatus => {
  if (sample.error) return "error";
  if (sample.limit) return "limit";
  if (sample.completed === false) return "incomplete";
  return "completed";
};

export interface Termination {
  time: number;
  status: SampleStatus;
  sample: SampleSummary;
}

export const terminations = (samples: SampleSummary[]): Termination[] =>
  samples
    .map((sample) => {
      const time = isoToEpoch(sample.completed_at);
      return time !== undefined
        ? { time, status: sampleStatus(sample), sample }
        : undefined;
    })
    .filter((t): t is Termination => t !== undefined)
    .sort((a, b) => a.time - b.time);

export interface StepPoint {
  time: number;
  value: number;
}

/** Concurrently-active sample count over time (+1 at start, -1 at end). */
export const activeSamplesSeries = (
  samples: SampleSummary[],
  window: TimeWindow,
  running = false
): StepPoint[] => {
  const deltas: { time: number; delta: number }[] = [];
  for (const sample of samples) {
    const start = isoToEpoch(sample.started_at);
    if (start === undefined) continue;
    deltas.push({ time: start, delta: 1 });
    const end = isoToEpoch(sample.completed_at);
    if (end !== undefined) {
      deltas.push({ time: end, delta: -1 });
    } else if (!running) {
      // No completed_at on a finished log means cancelled/crashed — step
      // down at the window end. On a live eval the sample is still going:
      // hold the line at the right edge instead of plunging to zero.
      deltas.push({ time: window.end, delta: -1 });
    }
  }
  if (deltas.length === 0) return [];
  deltas.sort((a, b) => a.time - b.time);
  const points: StepPoint[] = [{ time: window.start, value: 0 }];
  let value = 0;
  for (const { time, delta } of deltas) {
    value += delta;
    const last = points[points.length - 1];
    if (last && last.time === time) {
      last.value = value;
    } else {
      points.push({ time, value });
    }
  }
  return points;
};

const changeText = (change: ConfigValueChange): string => {
  if (change.cleared) {
    return `${change.name} cleared`;
  }
  if (change.value === null) {
    return `${change.name} lifted`;
  }
  return `${change.name} ${formatShort(change.previous)}→${formatShort(change.value)}`;
};

/** Compact value text for markers/rows — shared formatter, terse "null". */
export const formatShort = (value: unknown): string =>
  formatConfigValue(value, "null");

/** A full-height ◆ on the chart: a config retune or a tag/metadata edit. */
export type TimelineMarker = {
  time: number;
  /** Index into its source array — the History-row link. */
  index: number;
  label: string;
  postRun: boolean;
} & (
  { kind: "config"; update: ConfigUpdate } | { kind: "log"; update: LogUpdate }
);

export const markerKey = (kind: "config" | "log", index: number): string =>
  `${kind}:${index}`;

export const configMarkers = (
  updates: ConfigUpdate[] | null | undefined,
  runEnd?: number
): TimelineMarker[] =>
  (updates ?? [])
    .map((update, index): TimelineMarker | undefined => {
      const time = isoToEpoch(update.provenance.timestamp);
      if (time === undefined) return undefined;
      const label = `${update.changes.map(changeText).join(" · ")} · ${update.provenance.author}`;
      return {
        kind: "config",
        time,
        update,
        index,
        label,
        postRun: runEnd !== undefined && time > runEnd,
      };
    })
    .filter((m): m is TimelineMarker => m !== undefined)
    .sort((a, b) => a.time - b.time);

const logEditText = (update: LogUpdate): string => {
  const parts: string[] = [];
  for (const edit of update.edits) {
    if (edit.type === "tags") {
      parts.push(...edit.tags_add.map((tag) => `+${tag}`));
      parts.push(...edit.tags_remove.map((tag) => `−${tag}`));
    } else {
      parts.push(...Object.keys(edit.metadata_set).map((key) => `${key} set`));
      parts.push(...edit.metadata_remove.map((key) => `${key} removed`));
    }
  }
  return parts.join(" · ");
};

export const logMarkers = (
  updates: LogUpdate[] | null | undefined,
  runEnd?: number
): TimelineMarker[] =>
  (updates ?? [])
    .map((update, index): TimelineMarker | undefined => {
      const time = isoToEpoch(update.provenance.timestamp);
      if (time === undefined) return undefined;
      const label = `${logEditText(update)} · ${update.provenance.author}`;
      return {
        kind: "log",
        time,
        update,
        index,
        label,
        postRun: runEnd !== undefined && time > runEnd,
      };
    })
    .filter((m): m is TimelineMarker => m !== undefined)
    .sort((a, b) => a.time - b.time);

/** A violet dashed guide that steps at the ◆ that changed it. */
export interface GuideSegment {
  from: number;
  to: number;
  value: number;
}

export const guideSegments = (
  launchValue: number | null | undefined,
  knob: string,
  markers: TimelineMarker[],
  window: TimeWindow
): GuideSegment[] => {
  const segments: GuideSegment[] = [];
  let value = typeof launchValue === "number" ? launchValue : undefined;
  let from = window.start;
  for (const marker of markers) {
    if (marker.kind !== "config" || marker.postRun) continue;
    for (const change of marker.update.changes) {
      if (change.config !== "eval" || change.name !== knob) continue;
      const next = change.cleared
        ? typeof launchValue === "number"
          ? launchValue
          : undefined
        : typeof change.value === "number"
          ? change.value
          : undefined;
      if (value !== undefined && marker.time > from) {
        segments.push({ from, to: marker.time, value });
      }
      value = next;
      from = marker.time;
    }
  }
  if (value !== undefined && window.end > from) {
    segments.push({ from, to: window.end, value });
  }
  return segments;
};

export type HistoryCategory = "config" | "tags" | "runtime" | "connections";

export type HistoryRow = { time: number; postRun: boolean } & (
  | { kind: "config"; update: ConfigUpdate; index: number }
  | { kind: "logUpdate"; update: LogUpdate; index: number }
  | { kind: "runStart"; detail: string }
  | { kind: "runEnd"; status: EvalLogStatus; detail: string }
  | {
      kind: "connections";
      model: string;
      reason: ConnectionLimitChange["reason"];
      from: number;
      to: number;
      /** Contiguous controller steps aggregated into this row. */
      count: number;
    }
  | { kind: "sampleError"; sample: SampleSummary }
  | { kind: "sampleLimit"; sample: SampleSummary }
  | { kind: "fallback"; sample: SampleSummary; line: string }
  | { kind: "earlyStopping"; summary: EarlyStoppingSummary }
);

export const rowCategory = (row: HistoryRow): HistoryCategory => {
  switch (row.kind) {
    case "config":
      return "config";
    case "logUpdate":
      return "tags";
    case "connections":
      return "connections";
    default:
      return "runtime";
  }
};

const fmtDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
};

interface HistoryInputs {
  status?: EvalLogStatus;
  stats?: EvalStats;
  launchConfig?: EvalConfig;
  model?: string;
  configUpdates?: ConfigUpdate[] | null;
  logUpdates?: LogUpdate[] | null;
  earlyStopping?: EarlyStoppingSummary | null;
  samples: SampleSummary[];
}

/**
 * Every row the log header + sample summaries can produce, in time order.
 * Chart-only signals (per-sample started/ended, routine controller motion)
 * deliberately never become rows.
 */
export const historyRows = (inputs: HistoryInputs): HistoryRow[] => {
  const {
    status,
    stats,
    launchConfig,
    model,
    configUpdates,
    logUpdates,
    earlyStopping,
    samples,
  } = inputs;
  const rows: HistoryRow[] = [];
  const runStart = isoToEpoch(stats?.started_at);
  const runEnd = isoToEpoch(stats?.completed_at);

  if (runStart !== undefined) {
    const detail = [
      samples.length > 0 ? `${samples.length} samples` : undefined,
      launchConfig?.max_samples != null
        ? `max_samples ${launchConfig.max_samples}`
        : undefined,
      model,
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push({ kind: "runStart", time: runStart, postRun: false, detail });
  }

  (configUpdates ?? []).forEach((update, index) => {
    const time = isoToEpoch(update.provenance.timestamp);
    if (time === undefined) return;
    rows.push({
      kind: "config",
      time,
      postRun: runEnd !== undefined && time > runEnd,
      update,
      index,
    });
  });

  (logUpdates ?? []).forEach((update, index) => {
    const time = isoToEpoch(update.provenance.timestamp);
    if (time === undefined) return;
    rows.push({
      kind: "logUpdate",
      time,
      postRun: runEnd !== undefined && time > runEnd,
      update,
      index,
    });
  });

  // Controller events: rate limits and manual retunes are individually
  // newsworthy; contiguous same-reason scaling runs (slow start, steady up)
  // aggregate into one row per run so the controller's arc stays readable
  // without burying the rest of the history. Full per-step detail lives in
  // the Connection Log modal.
  const byModel = new Map<string, ConnectionLimitChange[]>();
  for (const event of stats?.connection_limit_history ?? []) {
    const list = byModel.get(event.model) ?? [];
    list.push(event);
    byModel.set(event.model, list);
  }
  for (const [model, events] of byModel) {
    events.sort((a, b) => a.timestamp - b.timestamp);
    let run: ConnectionLimitChange[] = [];
    const flush = () => {
      const first = run[0];
      const last = run[run.length - 1];
      if (!first || !last) return;
      rows.push({
        kind: "connections",
        time: last.timestamp,
        postRun: false,
        model,
        reason: first.reason,
        from: first.old_limit,
        to: last.new_limit,
        count: run.length,
      });
      run = [];
    };
    for (const event of events) {
      if (event.reason === "rate_limit" || event.reason === "manual") {
        flush();
        run = [event];
        flush();
      } else if (
        run.length > 0 &&
        run[run.length - 1]!.reason === event.reason
      ) {
        run.push(event);
      } else {
        flush();
        run = [event];
      }
    }
    flush();
  }

  for (const sample of samples) {
    const time = isoToEpoch(sample.completed_at);
    if (time === undefined) continue;
    if (sample.error) {
      rows.push({ kind: "sampleError", time, postRun: false, sample });
    }
    if (sample.limit) {
      rows.push({ kind: "sampleLimit", time, postRun: false, sample });
    }
    for (const fallback of sample.model_fallbacks ?? []) {
      rows.push({
        kind: "fallback",
        time,
        postRun: false,
        sample,
        line: `${fallback.model} → ${fallback.fallback_model}${(fallback.count ?? 1) > 1 ? ` × ${fallback.count}` : ""}`,
      });
    }
  }

  if (earlyStopping && runEnd !== undefined) {
    rows.push({
      kind: "earlyStopping",
      time: runEnd,
      postRun: false,
      summary: earlyStopping,
    });
  }

  if (runEnd !== undefined) {
    const completed = samples.filter(
      (s) => sampleStatus(s) === "completed"
    ).length;
    const errors = samples.filter((s) => !!s.error).length;
    const limits = samples.filter((s) => !!s.limit).length;
    const detail = [
      samples.length > 0 ? `${samples.length} samples` : undefined,
      completed > 0 ? `${completed} completed` : undefined,
      errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : undefined,
      limits > 0 ? `${limits} limit${limits === 1 ? "" : "s"}` : undefined,
      runStart !== undefined ? fmtDuration(runEnd - runStart) : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push({
      kind: "runEnd",
      time: runEnd,
      postRun: false,
      status: status ?? "success",
      detail,
    });
  }

  // Run lifecycle brackets everything that happened during the run: clock
  // skew can stamp a sample's completion milliseconds past run end, so
  // in-run rows sort by their time clamped to the run window, with the
  // lifecycle rows ranked to the outside of any resulting tie. Post-run
  // rows (config/tag amendments) keep their real times. Display always
  // shows the row's own time.
  const sortTime = (row: HistoryRow): number => {
    if (row.kind === "runStart" || row.kind === "runEnd" || row.postRun) {
      return row.time;
    }
    let time = row.time;
    if (runEnd !== undefined) time = Math.min(time, runEnd);
    if (runStart !== undefined) time = Math.max(time, runStart);
    return time;
  };
  return rows.sort(
    (a, b) => sortTime(a) - sortTime(b) || rowTieRank(a) - rowTieRank(b)
  );
};

/** Tie order at a shared (clamped) timestamp: runStart first, then config ◆
 *  (the cause sorts before its manual controller echo — the Connection Log
 *  modal applies the same rule), then everything else, then connection rows,
 *  with runEnd always last. */
const rowTieRank = (row: HistoryRow): number => {
  switch (row.kind) {
    case "runStart":
      return -2;
    case "config":
      return -1;
    case "connections":
      return 1;
    case "runEnd":
      return 2;
    default:
      return 0;
  }
};
