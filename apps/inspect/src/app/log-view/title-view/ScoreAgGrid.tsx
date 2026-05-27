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

interface ScoreAgGridProps {
  scoreGroups: ScoreSummary[][];
  showReducer?: boolean;
  className?: string | string[];
}

interface ScoreGridRow {
  scorer: string;
  scoredSamples?: number;
  unscoredSamples?: number;
  [metric: string]: string | number | undefined;
}

const kScorerColWidth = 180;
const kMetricColWidth = 120;

export const ScoreAgGrid: FC<ScoreAgGridProps> = ({
  scoreGroups,
  showReducer,
  className,
}) => {
  return (
    <div className={clsx(className, styles.gridContainer)}>
      {scoreGroups.map((group, i) => (
        <ScoreGroupGrid key={i} scoreGroup={group} showReducer={showReducer} />
      ))}
    </div>
  );
};

interface ScoreGroupGridProps {
  scoreGroup: ScoreSummary[];
  showReducer?: boolean;
}

const ScoreGroupGrid: FC<ScoreGroupGridProps> = ({
  scoreGroup,
  showReducer,
}) => {
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
      sortable: true,
      resizable: true,
      width: kMetricColWidth,
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
      sortable: true,
      resizable: true,
      width: kScorerColWidth,
      minWidth: 150,
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

    const naturalWidth = kScorerColWidth + metrics.length * kMetricColWidth;
    return {
      rowData: rows,
      columnDefs: columns,
      hasGroups: grouped,
      naturalWidth,
    };
  }, [scoreGroup, showReducer]);

  return (
    <div className={styles.groupGrid}>
      <div style={{ width: naturalWidth }}>
        <AgGridReact<ScoreGridRow>
          rowData={rowData}
          columnDefs={columnDefs}
          theme={themeBalham}
          domLayout="autoHeight"
          headerHeight={28}
          groupHeaderHeight={hasGroups ? 24 : 0}
          rowHeight={32}
          suppressCellFocus={true}
          suppressFieldDotNotation={true}
          enableCellTextSelection={true}
          animateRows={false}
        />
      </div>
    </div>
  );
};
