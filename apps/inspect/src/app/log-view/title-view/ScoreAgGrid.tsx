import { ColDef, ColGroupDef, themeBalham } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import clsx from "clsx";
import { FC, useMemo } from "react";

import { formatPrettyDecimal } from "@tsmono/util";

import "../../shared/agGrid";

import { groupMetricRuns, isGroupRun } from "../../../scoring/scores";
import { ScoreSummary } from "../../../scoring/types";

import styles from "./ScoreAgGrid.module.css";
import { UnscoredSamples } from "./UnscoredSamplesView";

// "Refined Classic" look: hairline rows, no wrapper/column chrome, muted
// headers, theme-driven colors so it tracks the --inspect-* light/dark mode.
const scoreGridTheme = themeBalham.withParams({
  fontFamily: "inherit",
  backgroundColor: "transparent",
  foregroundColor: "var(--inspect-foreground)",
  headerBackgroundColor: "transparent",
  headerTextColor: "var(--inspect-muted-foreground)",
  oddRowBackgroundColor: "transparent",
  borderColor: "var(--inspect-border)",
  rowBorder: { width: 1, color: "var(--inspect-border-color-translucent)" },
  headerRowBorder: { width: 1, color: "var(--inspect-border)" },
  wrapperBorder: false,
  columnBorder: false,
  headerColumnBorder: false,
});

const scoreGridThemeCompact = scoreGridTheme.withParams({
  fontSize: 12,
  headerFontSize: 11,
  cellHorizontalPadding: 8,
});

interface ScoreAgGridProps {
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
  [metric: string]: string | number | undefined;
}

const kScorerColWidth = 180;
const kMetricColWidth = 120;
const kScorerColWidthCompact = 110;
const kMetricColWidthCompact = 64;

export const ScoreAgGrid: FC<ScoreAgGridProps> = ({
  scoreGroups,
  showReducer,
  className,
  compact,
}) => {
  return (
    <div
      className={clsx(
        className,
        compact ? styles.cardContainer : styles.gridContainer
      )}
    >
      {scoreGroups.map((group, i) => (
        <ScoreGroupGrid
          key={i}
          scoreGroup={group}
          showReducer={showReducer}
          compact={compact}
        />
      ))}
    </div>
  );
};

interface ScoreGroupGridProps {
  scoreGroup: ScoreSummary[];
  showReducer?: boolean;
  compact?: boolean;
}

const ScoreGroupGrid: FC<ScoreGroupGridProps> = ({
  scoreGroup,
  showReducer,
  compact,
}) => {
  const scorerColWidth = compact ? kScorerColWidthCompact : kScorerColWidth;
  const metricColWidth = compact ? kMetricColWidthCompact : kMetricColWidth;
  // Compact card isn't resizable (resizing a tight summary breaks its layout)
  // and isn't sortable (it's a truncated view — sorting a partial set misleads).
  const resizable = !compact;
  const sortable = !compact;

  const { rowData, columnDefs, hasGroups, naturalWidth } = useMemo(() => {
    // All scorers in a scoreGroup share the same metric signature, so the
    // first scorer's metrics define the column set and metrics align by
    // index across scorers (dict-keys may differ, e.g. simple-list vs
    // per-key paths emit "yes" vs "frequency_yes" for the same column).
    const metrics = scoreGroup[0]?.metrics ?? [];
    const field = (i: number) => `metric_${i}`;

    const rows: ScoreGridRow[] = scoreGroup.map((score) => {
      const row: ScoreGridRow = {
        scorer:
          score.scorer +
          (showReducer && score.reducer ? ` (${score.reducer})` : ""),
        scoredSamples: score.scoredSamples,
        unscoredSamples: score.unscoredSamples,
      };
      score.metrics.forEach((m, i) => {
        row[field(i)] = m.value;
      });
      return row;
    });

    const lastIdx = metrics.length - 1;
    const runs = groupMetricRuns(metrics);
    const grouped = runs.some(isGroupRun);

    const leafCol = (
      name: string,
      i: number,
      inGroup: boolean
    ): ColDef<ScoreGridRow> => ({
      headerName: name,
      field: field(i),
      sortable: sortable,
      resizable: resizable,
      width: metricColWidth,
      cellClass: clsx(
        "ag-right-aligned-cell",
        i === lastIdx && styles.lastCell
      ),
      headerClass: clsx(
        "ag-right-aligned-header",
        i === lastIdx && styles.lastHeader,
        grouped && !inGroup && styles.noGroupBorder
      ),
      valueFormatter: (params) => {
        if (params.value == null) return "";
        return formatPrettyDecimal(params.value as number);
      },
      type: "numericColumn",
    });

    const metricColumns: (ColDef<ScoreGridRow> | ColGroupDef<ScoreGridRow>)[] =
      [];
    let idx = 0;
    for (const run of runs) {
      const inGroup = isGroupRun(run);
      const children = run.metrics.map((m) => leafCol(m.name, idx++, inGroup));
      if (inGroup) {
        metricColumns.push({
          headerName: run.group ?? "",
          headerClass: styles.groupHeader,
          suppressStickyLabel: true,
          children,
        });
      } else {
        metricColumns.push(...children);
      }
    }

    const scorerCol: ColDef<ScoreGridRow> = {
      headerName: "Scorer",
      field: "scorer",
      sortable: sortable,
      resizable: resizable,
      width: scorerColWidth,
      minWidth: compact ? 90 : 150,
      cellClass: styles.firstCell,
      headerClass: clsx(styles.firstHeader, grouped && styles.noGroupBorder),
      cellRenderer: (params: { data: ScoreGridRow | undefined }) => {
        const data = params.data;
        if (!data) return null;
        return (
          <span>
            {data.scorer}{" "}
            <UnscoredSamples
              scoredSamples={data.scoredSamples || 0}
              unscoredSamples={data.unscoredSamples || 0}
            />
          </span>
        );
      },
    };
    const columns: (ColDef<ScoreGridRow> | ColGroupDef<ScoreGridRow>)[] = [
      grouped ? { headerName: "", children: [scorerCol] } : scorerCol,
      ...metricColumns,
    ];

    const naturalWidth = scorerColWidth + metrics.length * metricColWidth;
    return {
      rowData: rows,
      columnDefs: columns,
      hasGroups: grouped,
      naturalWidth,
    };
  }, [
    scoreGroup,
    showReducer,
    compact,
    resizable,
    sortable,
    scorerColWidth,
    metricColWidth,
  ]);

  return (
    <div className={styles.groupGrid}>
      <div style={{ width: naturalWidth }}>
        <AgGridReact<ScoreGridRow>
          rowData={rowData}
          columnDefs={columnDefs}
          theme={compact ? scoreGridThemeCompact : scoreGridTheme}
          domLayout="autoHeight"
          headerHeight={compact ? 24 : 28}
          groupHeaderHeight={hasGroups ? (compact ? 20 : 24) : 0}
          rowHeight={compact ? 26 : 32}
          suppressCellFocus={true}
          suppressRowHoverHighlight={true}
          suppressFieldDotNotation={true}
          enableCellTextSelection={true}
          animateRows={false}
        />
      </div>
    </div>
  );
};
