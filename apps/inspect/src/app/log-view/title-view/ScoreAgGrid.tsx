import clsx from "clsx";
import { FC, useMemo } from "react";

import { ColDef, themeBalham } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { formatPrettyDecimal } from "@tsmono/util";

import "../../shared/agGrid";
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

export const ScoreAgGrid: FC<ScoreAgGridProps> = ({
  scoreGroups,
  showReducer,
  className,
}) => {
  const { rowData, columnDefs } = useMemo(() => {
    const metricNames: string[] = [];
    const metricNameSet = new Set<string>();
    for (const group of scoreGroups) {
      for (const score of group) {
        for (const metric of score.metrics) {
          if (!metricNameSet.has(metric.name)) {
            metricNameSet.add(metric.name);
            metricNames.push(metric.name);
          }
        }
      }
    }

    const rows: ScoreGridRow[] = [];
    for (const group of scoreGroups) {
      for (const score of group) {
        const row: ScoreGridRow = {
          scorer:
            score.scorer +
            (showReducer && score.reducer ? ` (${score.reducer})` : ""),
          scoredSamples: score.scoredSamples,
          unscoredSamples: score.unscoredSamples,
        };
        for (const metric of score.metrics) {
          row[`metric_${metric.name}`] = metric.value;
        }
        rows.push(row);
      }
    }

    const columns: ColDef<ScoreGridRow>[] = [
      {
        headerName: "Scorer",
        field: "scorer",
        sortable: true,
        resizable: true,
        flex: 1,
        minWidth: 100,
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
      },
      ...metricNames.map(
        (name): ColDef<ScoreGridRow> => ({
          headerName: name,
          field: `metric_${name}`,
          sortable: true,
          resizable: true,
          width: 120,
          valueFormatter: (params) => {
            if (params.value == null) return "";
            return formatPrettyDecimal(params.value as number);
          },
          type: "numericColumn",
        }),
      ),
    ];

    return { rowData: rows, columnDefs: columns };
  }, [scoreGroups, showReducer]);

  return (
    <div className={clsx(className, styles.gridContainer)}>
      <AgGridReact<ScoreGridRow>
        rowData={rowData}
        columnDefs={columnDefs}
        theme={themeBalham}
        domLayout="autoHeight"
        headerHeight={28}
        rowHeight={32}
        suppressCellFocus={true}
        enableCellTextSelection={true}
        animateRows={false}
      />
    </div>
  );
};
