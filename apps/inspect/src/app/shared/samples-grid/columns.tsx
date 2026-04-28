import type {
  ColDef,
  ICellRendererParams,
  ValueFormatterParams,
  ValueGetterParams,
} from "ag-grid-community";
import clsx from "clsx";

import { inputString } from "@tsmono/inspect-common/utils";
import { arrayToString, filename, formatNumber } from "@tsmono/util";

import { ScoreLabel } from "../../../app/types";
import { LogDetails } from "../../../client/api/types";
import { formatDateTime, formatTime } from "../../../utils/format";
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
import styles from "./SamplesGrid.module.css";
import { SampleRow } from "./types";

export type SampleGridViewMode = "list" | "grid";

export interface SampleGridContext {
  viewMode: SampleGridViewMode;
  multiLog: boolean;
  /** Single-log only — drives markdown rendering, score rendering, and
   *  initial visibility for `input`/`target`/`answer`. */
  descriptor?: SamplesDescriptor;
  /** Single-log only — score columns are emitted per-scorer in this mode. */
  selectedScores?: ScoreLabel[];
  /** Single-log — if exactly one scorer, the score column is labeled "Score". */
  scores?: ScoreLabel[];
  epochs?: number;
  /** Cross-log only — used to discover all distinct score names. */
  logDetails?: Record<string, LogDetails>;
}

const EmptyCell = () => <div>-</div>;

export const SCORE_FIELD_RAW_PREFIX = "score_";
export const SCORE_FIELD_PER_SCORER_PREFIX = "score__";

const perScorerFieldKey = (label: ScoreLabel): string =>
  `${SCORE_FIELD_PER_SCORER_PREFIX}${label.scorer}__${label.name}`;

const rawScoreFieldKey = (name: string): string =>
  `${SCORE_FIELD_RAW_PREFIX}${name}`;

/** Build the superset of sample columns. Visibility is *not* applied here
 *  — the caller (via `useSampleGridState`) controls `hide`. */
export function buildSampleColumns(ctx: SampleGridContext): ColDef<SampleRow>[] {
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
    width: isList ? 24 : undefined,
    initialWidth: isList ? undefined : 100,
    minWidth: isList ? 24 : 80,
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
        flex: 1,
        minWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
      },
      {
        colId: "model",
        field: "model",
        headerName: "Model",
        flex: 1,
        minWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
      },
      {
        colId: "logFile",
        field: "logFile",
        headerName: "Log File",
        flex: 1,
        minWidth: 150,
        sortable: true,
        filter: true,
        resizable: true,
        valueFormatter: (params: ValueFormatterParams<SampleRow>) =>
          filename(params.value),
      }
    );
  }

  // id (sample id)
  cols.push({
    colId: "sampleId",
    field: "sampleId",
    headerName: "Id",
    width: shape ? Math.max(35, (shape.idSize ?? 2) * 16) : undefined,
    initialWidth: shape ? undefined : 120,
    minWidth: 35,
    sortable: true,
    filter: true,
    resizable: true,
    valueGetter: (params: ValueGetterParams<SampleRow>) =>
      String(params.data?.sampleId ?? ""),
  });

  // epoch
  cols.push({
    colId: "epoch",
    field: "epoch",
    headerName: "Epoch",
    width: 60,
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
    flex: shape?.inputSize ? shape.inputSize : 3,
    minWidth: 80,
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
    flex: shape?.targetSize ? shape.targetSize : 1,
    minWidth: 80,
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
      flex: shape?.answerSize ? shape.answerSize : 1,
      minWidth: 80,
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

  // SCORE COLUMNS
  cols.push(...buildScoreColumns(ctx));

  // OPTIONAL columns — present in selector, default-visible only when data
  // exists. Initial visibility is seeded by `useSampleGridState`.
  if (multiLog) {
    cols.push({
      colId: "created",
      field: "created",
      headerName: "Created",
      initialWidth: 130,
      minWidth: 80,
      maxWidth: 140,
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

  cols.push(
    {
      colId: "error",
      field: "error",
      headerName: "Error",
      flex: 1,
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
      width: shape ? (shape.limitSize ?? 1) * 16 : undefined,
      initialWidth: shape ? undefined : 100,
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
      width: shape ? (shape.retriesSize ?? 1) * 16 : undefined,
      initialWidth: shape ? undefined : 80,
      minWidth: 28,
      sortable: true,
      filter: "agNumberColumnFilter",
      resizable: true,
      cellStyle: { textAlign: "center" },
      comparator: comparators.number,
      valueGetter: (params: ValueGetterParams<SampleRow>) =>
        params.data?.retries ?? params.data?.data?.retries,
    }
  );

  return cols;
}

/** Score columns — emitted in one of two modes. */
function buildScoreColumns(ctx: SampleGridContext): ColDef<SampleRow>[] {
  const { descriptor, selectedScores, scores, logDetails } = ctx;

  // Per-scorer mode (single-log with descriptor + selectedScores).
  if (descriptor && selectedScores && selectedScores.length > 0) {
    const useLabelHeader = !scores || scores.length !== 1;
    return selectedScores.map((label, i) => {
      const colId = perScorerFieldKey(label);
      return {
        colId,
        field: colId,
        headerName: useLabelHeader ? label.name : "Score",
        width: 80,
        minWidth: 28,
        sortable: true,
        filter: "agNumberColumnFilter",
        resizable: true,
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
            .score(row.data, selectedScores[i])
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
  const types: Record<string, Set<string>> = {};
  for (const details of Object.values(logDetails ?? {})) {
    for (const sample of details.sampleSummaries) {
      if (!sample.scores) continue;
      for (const [name, score] of Object.entries(sample.scores)) {
        if (!types[name]) types[name] = new Set();
        types[name].add(typeof score.value);
      }
    }
  }
  const scoreNames = Object.keys(types).sort((a, b) => a.localeCompare(b));
  return scoreNames.map((name) => {
    const isUniformNumber =
      types[name].size === 1 && types[name].has("number");
    return {
      colId: rawScoreFieldKey(name),
      field: rawScoreFieldKey(name),
      headerName: name,
      initialWidth: 100,
      minWidth: 60,
      sortable: true,
      filter: isUniformNumber ? "agNumberColumnFilter" : "agTextColumnFilter",
      resizable: true,
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
            String(a ?? "").localeCompare(String(b ?? "")),
    };
  });
}
