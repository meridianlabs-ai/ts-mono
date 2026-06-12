import type {
  ColDef,
  ICellRendererParams,
  ValueFormatterParams,
  ValueGetterParams,
} from "ag-grid-community";
import clsx from "clsx";

import { inputString, modelFallbackLines } from "@tsmono/inspect-common/utils";
import { arrayToString, filename, formatNumber } from "@tsmono/util";

import { ScoreLabel } from "../../../app/types";
import { LogDetails } from "../../../client/api/types";
import {
  kScoreTypeBoolean,
  kScoreTypeNumeric,
  kScoreTypePassFail,
} from "../../../constants";
import {
  formatDateTime,
  formatTime,
  valueAsString,
} from "../../../utils/format";
import { SamplesDescriptor } from "../../samples/descriptor/samplesDescriptor";
import {
  kDefaultSampleSortValue,
  sampleStatus,
  SampleStatusIcon,
  sampleStatusSortValue,
} from "../../samples/status/sampleStatus";
import gridCellsStyles from "../gridCells.module.css";
import { comparators } from "../gridComparators";

import { MarkdownCellDiv, ScoreCellDiv } from "./cells";
import {
  colorForValue,
  resolveScale,
  type WireScoreColorScale,
} from "./colorScale";
import { RotatedHeader } from "./RotatedHeader";
import styles from "./SamplesGrid.module.css";
import { SampleRow } from "./types";

export type SampleGridViewMode = "list" | "grid";

export interface SampleGridContext {
  viewMode: SampleGridViewMode;
  multiLog: boolean;
  /** Single-log only — drives markdown rendering, score rendering, and
   *  initial visibility for `input`/`target`/`answer`. */
  descriptor?: SamplesDescriptor;
  /** Single-log only — score columns are emitted per-scorer in this
   *  mode. Visibility (which scores are currently selected) is layered
   *  on by the caller via the column-visibility map. */
  scores?: ScoreLabel[];
  epochs?: number;
  /** Cross-log only — used to discover all distinct score names. */
  logDetails?: Record<string, LogDetails>;
  /** When true, score columns render compact: narrow widths with
   *  rotated 45° headers. Off by default. */
  compactScores?: boolean;
  /** Per-metric display label overrides, e.g. `{ "ascii-art": "ASCII
   *  Art" }`. Falls through to the raw metric name when a key isn't
   *  present. Sourced from the eval-author's `task_samples_view`. */
  scoreLabels?: Record<string, string>;
  /** Per-metric background colour scales, e.g. `{ "accuracy":
   *  "good-high", "verdict": { "yes": "bad" } }`. Numeric metrics use
   *  named palettes (gradient anchored at descriptor min/max);
   *  categorical metrics map values to semantic roles. Pass/fail and
   *  boolean metrics ignore this — their pills already carry the
   *  semantic. */
  scoreColorScales?: Record<string, WireScoreColorScale>;
}

const EmptyCell = () => <div>-</div>;

export const SCORE_FIELD_RAW_PREFIX = "score_";
export const SCORE_FIELD_PER_SCORER_PREFIX = "score__";

export const perScorerFieldKey = (label: ScoreLabel): string =>
  `${SCORE_FIELD_PER_SCORER_PREFIX}${label.scorer}__${label.name}`;

const rawScoreFieldKey = (name: string): string =>
  `${SCORE_FIELD_RAW_PREFIX}${name}`;

/** Build the superset of sample columns. Visibility is *not* applied here
 *  — the caller (via `useSampleGridState`) controls `hide`. */
export function buildSampleColumns(
  ctx: SampleGridContext
): ColDef<SampleRow>[] {
  const { viewMode, multiLog, descriptor, epochs } = ctx;
  const isList = viewMode === "list";
  const shape = descriptor?.messageShape;

  const cols: ColDef<SampleRow>[] = [];

  // # column — pinned-left index. Cross-log only (single-log doesn't
  // benefit from a separate index since rows are naturally ordered).
  if (multiLog) {
    cols.push({
      colId: "displayIndex",
      headerName: "#",
      initialWidth: 80,
      minWidth: 50,
      maxWidth: 80,
      sortable: false,
      filter: false,
      resizable: false,
      pinned: "left",
      cellRenderer: (params: ICellRendererParams<SampleRow>) => {
        if (params.data?.displayIndex === undefined) return "";
        return (
          <div className={gridCellsStyles.numberCell}>
            {params.data.displayIndex}
          </div>
        );
      },
    });
  }

  // sample-level status icon (always)
  cols.push({
    colId: "sampleStatus",
    field: "sampleStatus",
    headerName: isList ? "" : "Sample Status",
    headerTooltipValueGetter: () => "Sample Status",
    initialWidth: isList ? 28 : 100,
    minWidth: isList ? 28 : 80,
    valueGetter: (params: ValueGetterParams<SampleRow>) => {
      const row = params.data;
      if (!row) return kDefaultSampleSortValue;
      const completed = row.completed ?? row.data?.completed;
      const error = row.error ?? row.data?.error;
      const s = sampleStatus(completed, error);
      return sampleStatusSortValue(s, error);
    },
    cellRenderer: (params: ICellRendererParams<SampleRow>) => {
      if (!params.data) return null;
      const row = params.data;
      const completed = row.completed ?? row.data?.completed;
      const error = row.error ?? row.data?.error;
      const s = sampleStatus(completed, error);
      return <SampleStatusIcon status={s} />;
    },
    tooltipValueGetter: (params) => {
      const row = params.data;
      if (!row) return null;
      const completed = row.completed ?? row.data?.completed;
      const error = row.error ?? row.data?.error;
      return error ? error : sampleStatus(completed, error);
    },
  });

  // task / model / logFile / log status — cross-log only.
  if (multiLog) {
    cols.push(
      {
        colId: "status",
        field: "status",
        headerName: "Eval Status",
        initialWidth: 110,
        minWidth: 80,
        sortable: true,
        filter: true,
        resizable: true,
      },
      {
        colId: "task",
        field: "task",
        headerName: "Task",
        initialFlex: 1,
        minWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
      },
      {
        colId: "model",
        field: "model",
        headerName: "Model",
        initialFlex: 1,
        minWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
      },
      {
        colId: "logFile",
        field: "logFile",
        headerName: "Log File",
        initialFlex: 1,
        minWidth: 150,
        sortable: true,
        filter: true,
        resizable: true,
        valueFormatter: (params: ValueFormatterParams<SampleRow>) =>
          filename(params.value),
      },
      {
        colId: "completed_at",
        headerName: "Completed",
        initialWidth: 140,
        minWidth: 80,
        maxWidth: 160,
        sortable: true,
        filter: true,
        resizable: true,
        cellDataType: "date",
        valueGetter: (params: ValueGetterParams<SampleRow>) =>
          params.data?.data?.completed_at ?? undefined,
        filterValueGetter: (params: ValueGetterParams<SampleRow>) => {
          const v = params.data?.data?.completed_at;
          if (!v) return undefined;
          const d = new Date(v);
          return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        },
        valueFormatter: (params: ValueFormatterParams<SampleRow>) =>
          params.value ? formatDateTime(new Date(params.value)) : "",
        comparator: comparators.date,
      }
    );
  }

  // id (sample id)
  cols.push({
    colId: "sampleId",
    field: "sampleId",
    headerName: "Id",
    initialWidth: shape ? Math.max(35, (shape.idSize ?? 2) * 16) : 120,
    minWidth: 35,
    sortable: true,
    filter: true,
    resizable: true,
    valueGetter: (params: ValueGetterParams<SampleRow>) =>
      String(params.data?.sampleId ?? ""),
  });

  // sample uuid — opt-in via column selector. Visibility is driven by
  // the per-scope visibility map (defaulted off via
  // `defaultsForUnseededColumns`); we don't set `hide: true` here so the
  // column behaves like other optional columns (`created`, etc.).
  cols.push({
    colId: "sampleUuid",
    headerName: "UUID",
    initialWidth: 280,
    minWidth: 80,
    sortable: true,
    filter: true,
    resizable: true,
    valueGetter: (params: ValueGetterParams<SampleRow>) =>
      params.data?.data?.uuid ?? "",
  });

  // epoch
  cols.push({
    colId: "epoch",
    field: "epoch",
    headerName: "Epoch",
    initialWidth: 60,
    minWidth: 40,
    sortable: true,
    filter: true,
    resizable: true,
    cellStyle: { textAlign: "center" },
    comparator: comparators.number,
    // Hide when single-log and epochs ≤ 1 (no meaningful data).
    hide: !multiLog && epochs !== undefined && epochs <= 1,
  });

  // input
  cols.push({
    colId: "input",
    field: "input",
    headerName: "Input",
    initialFlex: shape?.inputSize ? shape.inputSize : 3,
    minWidth: 240,
    sortable: true,
    filter: true,
    resizable: true,
    cellStyle: isList
      ? undefined
      : { overflow: "hidden", textOverflow: "ellipsis" },
    valueGetter: (params: ValueGetterParams<SampleRow>) => {
      const row = params.data;
      if (!row) return "";
      if (row.input !== undefined) return row.input;
      if (row.data) return inputString(row.data.input).join(" ");
      return "";
    },
    cellRenderer: isList
      ? (params: ICellRendererParams<SampleRow>) => {
          const row = params.data;
          if (!row) return null;
          const text =
            row.input ??
            (row.data ? inputString(row.data.input).join(" ") : "");
          return <MarkdownCellDiv semanticClass="sample-input" text={text} />;
        }
      : undefined,
  });

  // target
  cols.push({
    colId: "target",
    field: "target",
    headerName: "Target",
    initialFlex: shape?.targetSize ? shape.targetSize : 1,
    minWidth: 120,
    sortable: true,
    filter: true,
    resizable: true,
    cellStyle: isList
      ? undefined
      : { overflow: "hidden", textOverflow: "ellipsis" },
    valueGetter: (params: ValueGetterParams<SampleRow>) => {
      const row = params.data;
      if (!row) return "";
      if (row.target !== undefined) return row.target;
      if (row.data?.target != null) return arrayToString(row.data.target);
      return "";
    },
    cellRenderer: isList
      ? (params: ICellRendererParams<SampleRow>) => {
          const row = params.data;
          if (!row) return null;
          const text =
            row.target ??
            (row.data?.target != null ? arrayToString(row.data.target) : "");
          if (!text) return null;
          return (
            <MarkdownCellDiv
              semanticClass="sample-target"
              text={text}
              trimRenderedText
            />
          );
        }
      : undefined,
  });

  // answer (only meaningful when descriptor present)
  if (descriptor) {
    cols.push({
      colId: "answer",
      field: "answer",
      headerName: "Answer",
      initialFlex: shape?.answerSize ? shape.answerSize : 1,
      minWidth: 120,
      sortable: true,
      filter: true,
      resizable: true,
      cellStyle: isList
        ? undefined
        : { overflow: "hidden", textOverflow: "ellipsis" },
      valueGetter: (params: ValueGetterParams<SampleRow>) =>
        params.data?.answer ?? "",
      cellRenderer: isList
        ? (params: ICellRendererParams<SampleRow>) => {
            if (!params.data) return null;
            return (
              <MarkdownCellDiv
                semanticClass="sample-answer"
                text={params.data.answer || ""}
                trimRenderedText
              />
            );
          }
        : undefined,
    });
  }

  // tokens
  cols.push({
    colId: "tokens",
    field: "tokens",
    headerName: "Tokens",
    initialWidth: 100,
    minWidth: 60,
    maxWidth: 140,
    sortable: true,
    filter: "agNumberColumnFilter",
    resizable: true,
    cellRenderer: (params: ICellRendererParams<SampleRow>) =>
      params.value === undefined || params.value === null ? (
        <EmptyCell />
      ) : (
        <div>{formatNumber(params.value)}</div>
      ),
  });

  // duration
  cols.push({
    colId: "duration",
    field: "duration",
    headerName: "Duration",
    initialWidth: 120,
    minWidth: 70,
    maxWidth: 160,
    sortable: true,
    filter: "agNumberColumnFilter",
    resizable: true,
    valueFormatter: (params: ValueFormatterParams<SampleRow>) =>
      params.value === undefined || params.value === null
        ? ""
        : formatTime(params.value),
    cellRenderer: (params: ICellRendererParams<SampleRow>) =>
      params.value === undefined || params.value === null ? (
        <EmptyCell />
      ) : (
        <div>{formatTime(params.value)}</div>
      ),
    tooltipValueGetter: (params) =>
      params.value === undefined || params.value === null
        ? undefined
        : formatTime(params.value),
  });

  // OPTIONAL columns kept before scores so a scrolling user sees
  // halted/limited/retried-sample signals without scrolling past the
  // (often wide) score-column block. Default visibility is seeded by
  // `useSampleGridState`.
  cols.push(
    {
      colId: "error",
      field: "error",
      headerName: "Error",
      initialFlex: 1,
      minWidth: 100,
      sortable: true,
      filter: true,
      resizable: true,
      cellStyle: isList
        ? undefined
        : { overflow: "hidden", textOverflow: "ellipsis" },
      valueGetter: (params: ValueGetterParams<SampleRow>) =>
        params.data?.error ?? params.data?.data?.error ?? "",
      cellRenderer: isList
        ? (params: ICellRendererParams<SampleRow>) => {
            const text = params.value as string;
            if (!text) return null;
            return (
              <div
                className={clsx(
                  "sample-error",
                  styles.cell,
                  styles.wrapAnywhere,
                  "three-line-clamp"
                )}
              >
                {text}
              </div>
            );
          }
        : undefined,
    },
    {
      colId: "limit",
      field: "limit",
      headerName: "Limit",
      initialWidth: shape ? (shape.limitSize ?? 1) * 16 : 100,
      minWidth: 28,
      sortable: true,
      filter: true,
      resizable: true,
      valueGetter: (params: ValueGetterParams<SampleRow>) =>
        params.data?.limit ?? params.data?.data?.limit,
    },
    {
      colId: "retries",
      field: "retries",
      headerName: "Retries",
      initialWidth: shape ? (shape.retriesSize ?? 1) * 16 : 80,
      minWidth: 28,
      sortable: true,
      filter: "agNumberColumnFilter",
      resizable: true,
      cellStyle: { textAlign: "center" },
      comparator: comparators.number,
      valueGetter: (params: ValueGetterParams<SampleRow>) =>
        params.data?.retries ?? params.data?.data?.retries,
    },
    {
      colId: "fallbacks",
      field: "fallbacks",
      headerName: "Fallbacks",
      // size for the header text — the cell value is just a small count
      initialWidth: 95,
      minWidth: 28,
      sortable: true,
      filter: "agNumberColumnFilter",
      resizable: true,
      cellStyle: { textAlign: "center" },
      comparator: comparators.number,
      valueGetter: (params: ValueGetterParams<SampleRow>) =>
        params.data?.fallbacks,
      tooltipValueGetter: (params) => {
        const lines = modelFallbackLines(params.data?.data?.model_fallbacks);
        return lines.length > 0 ? lines.join("\n") : undefined;
      },
    }
  );

  // SCORE COLUMNS
  cols.push(...buildScoreColumns(ctx));

  if (multiLog) {
    cols.push({
      colId: "created",
      field: "created",
      headerName: "Eval Created",
      initialWidth: 140,
      minWidth: 80,
      maxWidth: 160,
      sortable: true,
      filter: true,
      resizable: true,
      cellDataType: "date",
      filterValueGetter: (params: ValueGetterParams<SampleRow>) => {
        if (!params.data?.created) return undefined;
        const d = new Date(params.data.created);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      },
      valueFormatter: (params: ValueFormatterParams<SampleRow>) =>
        params.value ? formatDateTime(new Date(params.value)) : "",
    });
  }

  // Phantom spacer at the right end — only in compact mode. Compact
  // mode's rotated labels extend ~92px past the rightmost score
  // column. Without trailing room, max horizontal scroll leaves the
  // last label clipped (or visually right at the viewport edge with
  // no breathing room). A real ag-grid column is the cleanest way
  // to extend the scrollable extent because the body, header, and
  // bottom scrollbar all see it natively, so they stay in lock-step.
  if (ctx.compactScores) {
    cols.push({
      colId: "compactSpacer",
      headerName: "",
      headerClass: styles.spacerHeader,
      width: 95,
      minWidth: 95,
      maxWidth: 95,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
      suppressNavigable: true,
      lockVisible: true,
      lockPosition: "right",
    });
  }

  return cols;
}

/** Score columns — emitted in one of two modes. */
function buildScoreColumns(ctx: SampleGridContext): ColDef<SampleRow>[] {
  const {
    descriptor,
    scores,
    logDetails,
    compactScores,
    scoreLabels,
    scoreColorScales,
  } = ctx;

  // Resolve a metric name through the eval-author's label overrides,
  // falling back to the raw name. Used for the visible header text;
  // colId / field are still keyed off the raw name so filter / sort
  // / persistence stay stable across label changes.
  const labelFor = (name: string): string => scoreLabels?.[name] ?? name;

  // Build an ag-grid `cellStyle` callback for the score column whose
  // metric is `name`, given its descriptor bounds. Returns undefined
  // when no scale is configured (or it can't be resolved against the
  // bounds), so the cell renders with no background.
  const cellStyleFor = (
    name: string,
    bounds: { min?: number; max?: number }
  ): ColDef<SampleRow>["cellStyle"] | undefined => {
    const wire = scoreColorScales?.[name];
    if (!wire) return undefined;
    const resolved = resolveScale(wire, bounds);
    if (!resolved) return undefined;
    return (params) => {
      const c = colorForValue(resolved, params.value);
      return c ? { backgroundColor: c } : undefined;
    };
  };

  // Per-scorer mode (single-log with descriptor). One column per
  // *available* score; visibility is driven by `selectedScores` upstream
  // so the unified column chooser can toggle scorers on and off.
  if (descriptor && scores && scores.length > 0) {
    const useLabelHeader = scores.length !== 1;
    return scores.map((label) => {
      const colId = perScorerFieldKey(label);
      const headerName = useLabelHeader ? labelFor(label.name) : "Score";
      const scoreDesc = descriptor.evalDescriptor.scoreDescriptor(label);
      const scoreType = scoreDesc?.scoreType;
      const isNumeric = scoreType === kScoreTypeNumeric;
      // Pass/fail and boolean already render as semantically-coloured
      // pills via the descriptor; painting a background under them
      // would clash. Only opt the *other* score types into the
      // configured colour scale.
      const acceptsColorScale =
        scoreType !== kScoreTypePassFail && scoreType !== kScoreTypeBoolean;
      const cellStyle = acceptsColorScale
        ? cellStyleFor(label.name, {
            min: scoreDesc?.min,
            max: scoreDesc?.max,
          })
        : undefined;
      // Compact mode collapses to ~40px (numeric) / ~55px (non-numeric)
      // and lets the rotated label fan up-right out of the cell.
      // Numeric scores render as a short formatted number; non-numeric
      // scores render as one or two coloured "C/I"-style pills which
      // need more room. Horizontal mode sizes to fit the header text:
      // 6.2px/char + 40px covers sort icon, filter icon, padding,
      // gutter under the Balham theme. `initialWidth` (not `width`) so
      // user resize persists; SamplesTab forces a re-fit explicitly
      // when `compactScores` toggles.
      const compactWidth = isNumeric ? 40 : 55;
      const headerCols: Partial<ColDef<SampleRow>> = compactScores
        ? {
            headerComponent: RotatedHeader,
            headerClass: styles.rotatedHeader,
            initialWidth: compactWidth,
            minWidth: compactWidth - 4,
          }
        : {
            initialWidth: Math.max(
              70,
              Math.round(headerName.length * 6.2) + 40
            ),
            minWidth: 60,
            maxWidth: 120,
          };
      return {
        colId,
        field: colId,
        headerName,
        ...headerCols,
        sortable: true,
        filter: isNumeric ? "agNumberColumnFilter" : "agTextColumnFilter",
        resizable: true,
        cellStyle,
        comparator: isNumeric
          ? comparators.number
          : (a: unknown, b: unknown) =>
              valueAsString(a ?? "").localeCompare(valueAsString(b ?? "")),
        valueGetter: (params: ValueGetterParams<SampleRow>) => {
          const data = params.data?.data;
          if (!data) return undefined;
          return descriptor.evalDescriptor.score(data, label)?.value;
        },
        cellRenderer: (params: ICellRendererParams<SampleRow>) => {
          const row = params.data;
          if (!row?.data) return null;
          const completed = row.completed ?? row.data.completed;
          const rendered = descriptor.evalDescriptor
            .score(row.data, label)
            ?.render();
          if (completed && rendered !== undefined) {
            return <ScoreCellDiv>{rendered}</ScoreCellDiv>;
          }
          return <ScoreCellDiv />;
        },
      };
    });
  }

  // Raw mode — discover score names across the supplied logDetails. Detect
  // type collisions so a name with mixed value types falls back to text.
  // Also tally numeric min/max per column so colour-scale gradients
  // have something to anchor against (no descriptor exists in raw mode).
  const types: Record<string, Set<string>> = {};
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const details of Object.values(logDetails ?? {})) {
    for (const sample of details.sampleSummaries) {
      if (!sample.scores) continue;
      for (const [name, score] of Object.entries(sample.scores)) {
        if (!types[name]) types[name] = new Set();
        types[name].add(typeof score.value);
        if (typeof score.value === "number" && Number.isFinite(score.value)) {
          const r = ranges[name];
          if (!r) ranges[name] = { min: score.value, max: score.value };
          else {
            if (score.value < r.min) r.min = score.value;
            if (score.value > r.max) r.max = score.value;
          }
        }
      }
    }
  }
  const scoreNames = Object.keys(types).sort((a, b) => a.localeCompare(b));
  return scoreNames.map((name) => {
    const isUniformNumber = types[name].size === 1 && types[name].has("number");
    const compactWidth = isUniformNumber ? 40 : 55;
    // Numeric raw scores can use a colour-scale gradient against the
    // observed min/max; non-numeric raw scores accept categorical maps
    // only. Boolean would already be a "boolean" typeof — passes through
    // to categorical handling, where the resolver matches `"true"` /
    // `"false"` keys.
    const cellStyle = cellStyleFor(name, ranges[name] ?? {});
    const headerCols: Partial<ColDef<SampleRow>> = compactScores
      ? {
          headerComponent: RotatedHeader,
          headerClass: styles.rotatedHeader,
          initialWidth: compactWidth,
          minWidth: compactWidth - 4,
        }
      : { initialWidth: 100, minWidth: 60 };
    return {
      colId: rawScoreFieldKey(name),
      field: rawScoreFieldKey(name),
      headerName: labelFor(name),
      ...headerCols,
      sortable: true,
      filter: isUniformNumber ? "agNumberColumnFilter" : "agTextColumnFilter",
      resizable: true,
      cellStyle,
      valueFormatter: (params: ValueFormatterParams<SampleRow>) => {
        const v = params.value;
        if (v === "" || v === null || v === undefined) return "";
        if (Array.isArray(v)) return v.join(", ");
        if (typeof v === "object") return JSON.stringify(v);
        if (typeof v === "number") return v.toFixed(3);
        return String(v);
      },
      comparator: isUniformNumber
        ? comparators.number
        : (a: unknown, b: unknown) =>
            valueAsString(a ?? "").localeCompare(valueAsString(b ?? "")),
    };
  });
}
