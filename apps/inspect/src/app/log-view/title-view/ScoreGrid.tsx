import {
  ColumnDef,
  columnVisibilityFeature,
  createSortedRowModel,
  flexRender,
  Header,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import clsx from "clsx";
import { FC, ReactElement, useMemo, useState } from "react";

import { formatPrettyDecimal } from "@tsmono/util";

import { groupMetricRuns, isGroupRun } from "../../../scoring/scores";
import { ScoreSummary } from "../../../scoring/types";

import styles from "./ScoreGrid.module.css";
import { UnscoredSamples } from "./UnscoredSamplesView";

interface ScoreGridProps {
  scoreGroups: ScoreSummary[][];
  showReducer?: boolean;
  className?: string | string[];
  /** Tighter type/spacing for the title-region summary card. */
  compact?: boolean;
}

interface ScoreGridRow {
  scorer: string;
  scoredSamples?: number;
  unscoredSamples?: number;
  metrics: (number | undefined)[];
}

const scoreGridFeatures = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

type ScoreGridFeatures = typeof scoreGridFeatures;

const kMetricColWidth = 120;
const kScorerColWidthCompact = 110;
const kMetricColWidthCompact = 64;

export const ScoreGrid: FC<ScoreGridProps> = ({
  scoreGroups,
  showReducer,
  className,
  compact,
}) => {
  return (
    // data-testid: stable hook for tests that assert on this container's
    // scroll behavior, so they don't depend on the internal wrapper depth
    <div
      data-testid="score-grid"
      className={clsx(
        className,
        compact ? styles.cardContainer : styles.gridContainer
      )}
    >
      {scoreGroups.map((group, i) => (
        <ScoreGroupTable
          key={i}
          scoreGroup={group}
          showReducer={showReducer}
          compact={compact}
        />
      ))}
    </div>
  );
};

interface ScoreGroupTableProps {
  scoreGroup: ScoreSummary[];
  showReducer?: boolean;
  compact?: boolean;
}

const ScoreGroupTable: FC<ScoreGroupTableProps> = ({
  scoreGroup,
  showReducer,
  compact,
}) => {
  // The full view's scorer column is content-sized (its minimum lives in
  // CSS): a fixed <col> width also caps an auto-layout column's width.
  const scorerColWidth = compact ? kScorerColWidthCompact : undefined;
  const metricColWidth = compact ? kMetricColWidthCompact : kMetricColWidth;
  // Compact card isn't sortable: it's a truncated view — sorting a partial
  // set misleads.
  const sortable = !compact;
  const [sorting, setSorting] = useState<SortingState>([]);

  const { rows, columns, compactWidth } = useMemo(() => {
    // All scorers in a scoreGroup share the same metric signature, so the
    // first scorer's metrics define the column set and metrics align by
    // index across scorers (dict-keys may differ, e.g. simple-list vs
    // per-key paths emit "yes" vs "frequency_yes" for the same column).
    const metrics = scoreGroup[0]?.metrics ?? [];

    const rows: ScoreGridRow[] = scoreGroup.map((score) => ({
      scorer:
        score.scorer +
        (showReducer && score.reducer ? ` (${score.reducer})` : ""),
      scoredSamples: score.scoredSamples,
      unscoredSamples: score.unscoredSamples,
      metrics: score.metrics.map((m) => m.value),
    }));

    const leafCol = (
      name: string,
      i: number
    ): ColumnDef<ScoreGridFeatures, ScoreGridRow> => ({
      id: `metric_${i}`,
      header: name,
      accessorFn: (row) => row.metrics[i],
      enableSorting: sortable,
      cell: ({ getValue }) => {
        const value = getValue<number | undefined>();
        return value == null ? "" : formatPrettyDecimal(value);
      },
    });

    const runs = groupMetricRuns(metrics);
    const grouped = runs.some(isGroupRun);

    const metricColumns: ColumnDef<ScoreGridFeatures, ScoreGridRow>[] = [];
    let idx = 0;
    for (const [runIdx, run] of runs.entries()) {
      // Indexing arithmetic (not idx++ in the lambda) keeps this compilable
      // by React Compiler, which can't lower captured UpdateExpressions.
      const runStart = idx;
      const children = run.metrics.map((m, i) => leafCol(m.name, runStart + i));
      idx += run.metrics.length;
      if (isGroupRun(run)) {
        metricColumns.push({
          id: `group_${runIdx}`,
          header: run.group ?? "",
          columns: children,
        });
      } else {
        metricColumns.push(...children);
      }
    }

    const scorerCol: ColumnDef<ScoreGridFeatures, ScoreGridRow> = {
      id: "scorer",
      header: "Scorer",
      accessorFn: (row) => row.scorer,
      enableSorting: sortable,
      cell: ({ row }) => (
        <span>
          {row.original.scorer}{" "}
          <UnscoredSamples
            scoredSamples={row.original.scoredSamples || 0}
            unscoredSamples={row.original.unscoredSamples || 0}
          />
        </span>
      ),
    };

    const columns: ColumnDef<ScoreGridFeatures, ScoreGridRow>[] = [
      grouped
        ? { id: "scorer_group", header: "", columns: [scorerCol] }
        : scorerCol,
      ...metricColumns,
    ];

    return {
      rows,
      columns,
      compactWidth:
        kScorerColWidthCompact + metrics.length * kMetricColWidthCompact,
    };
  }, [scoreGroup, showReducer, sortable]);

  const table = useTable({
    features: scoreGridFeatures,
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    enableMultiSort: false,
  });

  const leafColumns = table.getVisibleLeafColumns();
  const lastLeafId = leafColumns[leafColumns.length - 1]?.id;
  const headerGroups = table.getHeaderGroups();

  return (
    <div className={styles.groupGrid}>
      <table
        className={clsx(styles.table, compact && styles.compact)}
        style={compact ? { width: compactWidth } : undefined}
      >
        <colgroup>
          {leafColumns.map((col) => (
            <col
              key={col.id}
              style={{
                width: col.id === "scorer" ? scorerColWidth : metricColWidth,
              }}
            />
          ))}
        </colgroup>
        <thead>
          {headerGroups.map((headerGroup, groupIdx) =>
            groupIdx === headerGroups.length - 1 ? (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <LeafHeader
                    key={header.id}
                    header={header}
                    isLast={header.column.id === lastLeafId}
                    compact={compact}
                  />
                ))}
              </tr>
            ) : (
              <tr key={headerGroup.id} className={styles.groupRow}>
                {headerGroup.headers.map((header) => {
                  const labeled =
                    !header.isPlaceholder &&
                    header.column.columnDef.header !== "";
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      className={clsx(labeled && styles.groupLabel)}
                      title={
                        labeled ? compactTitle(header, compact) : undefined
                      }
                    >
                      {labeled
                        ? flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )
                        : null}
                    </th>
                  );
                })}
              </tr>
            )
          )}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={clsx(
                    cell.column.id === "scorer"
                      ? styles.scorerCell
                      : styles.numericCell,
                    cell.column.id === lastLeafId && styles.lastCell
                  )}
                  title={
                    compact && cell.column.id === "scorer"
                      ? cell.row.original.scorer
                      : undefined
                  }
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// The compact card's fixed columns ellipsize long names; the title keeps the
// full text reachable on hover. The full view never truncates, so it skips it.
const compactTitle = (
  header: Header<ScoreGridFeatures, ScoreGridRow, unknown>,
  compact: boolean | undefined
): string | undefined => {
  const label = header.column.columnDef.header;
  return compact && typeof label === "string" ? label : undefined;
};

const LeafHeader = ({
  header,
  isLast,
  compact,
}: {
  header: Header<ScoreGridFeatures, ScoreGridRow, unknown>;
  isLast: boolean;
  compact: boolean | undefined;
}): ReactElement => {
  const sorted = header.column.getIsSorted();
  const canSort = header.column.getCanSort();
  const isScorer = header.column.id === "scorer";
  const label = flexRender(header.column.columnDef.header, header.getContext());
  // Sortable headers reserve the arrow's slot even when unsorted: the full
  // view's columns are content-sized, so an arrow popping in would widen one.
  const arrow = canSort && (
    <i
      className={clsx(
        sorted === "asc" ? "bi bi-arrow-up" : "bi bi-arrow-down",
        styles.sortIcon,
        !sorted && styles.sortIconIdle
      )}
      aria-hidden="true"
    />
  );
  return (
    <th
      className={clsx(
        isScorer ? styles.scorerHeader : styles.numericHeader,
        isLast && styles.lastHeader,
        canSort && styles.sortable
      )}
      aria-sort={
        sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined
      }
      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
      title={compactTitle(header, compact)}
    >
      {/* Arrow goes on the label's un-anchored side — left for right-aligned
          numeric headers, right for the left-aligned scorer — so the text
          doesn't shift when a sort pops the arrow in. */}
      <span className={styles.headerLabel}>
        {isScorer ? (
          <>
            {label}
            {arrow}
          </>
        ) : (
          <>
            {arrow}
            {label}
          </>
        )}
      </span>
    </th>
  );
};
