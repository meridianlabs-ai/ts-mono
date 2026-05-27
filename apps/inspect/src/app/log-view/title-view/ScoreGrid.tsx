import clsx from "clsx";
import { FC, Fragment, ReactNode } from "react";

import { formatPrettyDecimal } from "@tsmono/util";

import { groupMetricRuns, isGroupRun } from "../../../scoring/scores";
import { ScoreSummary } from "../../../scoring/types";

import styles from "./ScoreGrid.module.css";
import { UnscoredSamples } from "./UnscoredSamplesView";

interface ScoreGridProps {
  scoreGroups: ScoreSummary[][];
  showReducer?: boolean;
  className?: string | string[];
  striped?: boolean;
}

export const ScoreGrid: FC<ScoreGridProps> = ({
  scoreGroups,
  showReducer,
  className,
  striped,
}) => {
  const columnCount = scoreGroups.reduce((prev, group) => {
    return Math.max(prev, group[0].metrics.length);
  }, 0);

  const subTables: ReactNode[] = [];

  let index = 0;
  for (const scoreGroup of scoreGroups) {
    const metrics = scoreGroup[0].metrics;
    const runs = groupMetricRuns(metrics);
    const showGroups = runs.some(isGroupRun);

    const labelClass = clsx(
      "text-style-label",
      "text-style-secondary",
      "text-size-small",
      styles.label
    );

    const groupCells: ReactNode[] = [];
    if (showGroups) {
      runs.forEach((run, ri) => {
        const isGroup = isGroupRun(run);
        groupCells.push(
          <th
            key={`g-${ri}`}
            colSpan={run.metrics.length}
            className={clsx(labelClass, isGroup ? styles.groupHeader : null)}
          >
            {isGroup ? run.group : ""}
          </th>
        );
      });
      for (let i = metrics.length; i < columnCount; i++) {
        groupCells.push(<td key={`g-pad-${i}`}></td>);
      }
    }

    const cells: ReactNode[] = [];
    for (let i = 0; i < columnCount; i++) {
      if (metrics.length > i) {
        cells.push(
          <th key={i} className={labelClass}>
            {metrics[i].name}
          </th>
        );
      } else {
        cells.push(<td key={i}></td>);
      }
    }

    const headerRow = (
      <thead>
        {showGroups ? (
          <tr className={clsx(styles.headerRow)}>
            <td></td>
            {groupCells}
          </tr>
        ) : null}
        <tr className={clsx(styles.headerRow)}>
          <td></td>
          {cells}
        </tr>
      </thead>
    );
    const rows: ReactNode[] = [];
    scoreGroup.forEach((g, rowIndex) => {
      const cells: ReactNode[] = [];
      for (let i = 0; i < columnCount; i++) {
        if (metrics.length > i) {
          cells.push(
            <td key={i} className={clsx(styles.value, "text-size-small")}>
              {formatPrettyDecimal(g.metrics[i].value)}
            </td>
          );
        } else {
          cells.push(<td key={i} className={clsx(styles.value)}></td>);
        }
      }

      rows.push(
        <tr key={rowIndex}>
          <th className={clsx(styles.scorer, "text-size-small")}>
            {g.scorer} {showReducer && g.reducer ? `(${g.reducer})` : undefined}
            <UnscoredSamples
              scoredSamples={g.scoredSamples || 0}
              unscoredSamples={g.unscoredSamples || 0}
            />
          </th>
          {cells}
        </tr>
      );
    });

    subTables.push(
      <Fragment key={index}>
        {index > 0 ? (
          <tbody className={clsx(styles.tableSeparator)}>
            <tr>
              <td
                colSpan={columnCount + 1}
                className={clsx(styles.groupSeparator)}
              ></td>
            </tr>
          </tbody>
        ) : undefined}
        {headerRow}
        <tbody className={clsx("table-group-divider", styles.tableBody)}>
          {rows}
        </tbody>
      </Fragment>
    );

    index++;
  }

  return (
    <table
      className={clsx(
        className,
        "table",
        striped ? "table-striped" : undefined,
        styles.table,
        "table-bordered"
      )}
    >
      {subTables}
    </table>
  );
};
