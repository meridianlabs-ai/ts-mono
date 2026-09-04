import clsx from "clsx";
import { FC, ReactNode } from "react";

import { EvalPlan, EvalScore, EvalSpec } from "@tsmono/inspect-common/types";

import { DatasetDetailView } from "./DatasetDetailView";
import styles from "./PlanDetailView.module.css";
import { ScorerDetailView } from "./ScorerDetailView";
import { SolversDetailView } from "./SolverDetailView";

interface PlanDetailViewProps {
  evaluation?: EvalSpec;
  plan?: EvalPlan;
  scores?: EvalScore[];
}

export const PlanDetailView: FC<PlanDetailViewProps> = ({
  evaluation,
  plan,
  scores,
}) => {
  if (!evaluation) {
    return null;
  }

  const steps = plan?.steps;

  const taskColumns: {
    title: string;
    className: string | string[] | undefined;
    contents: ReactNode;
  }[] = [];
  taskColumns.push({
    title: "Dataset",
    className: styles.floatingCol,
    contents: <DatasetDetailView dataset={evaluation.dataset} />,
  });

  if (steps) {
    taskColumns.push({
      title: "Solvers",
      className: styles.wideCol,
      contents: <SolversDetailView steps={steps} />,
    });
  }

  if (scores) {
    // Map, not a plain object: scorer names come from the log header, and a
    // name such as "constructor" would otherwise read an inherited member as
    // an existing group.
    const scorers = new Map<
      string,
      { scores: string[]; params: Record<string, unknown> }
    >();
    for (const score of scores) {
      const existing = scorers.get(score.scorer);
      if (existing === undefined) {
        scorers.set(score.scorer, {
          scores: [score.name],
          params: score.params,
        });
      } else {
        existing.scores.push(score.name);
      }
    }

    if (scorers.size > 0) {
      const label = scorers.size === 1 ? "Scorer" : "Scorers";
      const scorerPanels = [...scorers].map(([key, scorer]) => (
        <ScorerDetailView
          key={key}
          name={key}
          scores={scorer.scores}
          params={scorer.params}
        />
      ));

      taskColumns.push({
        title: label,
        className: styles.floatingCol,
        contents: scorerPanels,
      });
    }
  }

  return (
    <div className={styles.container}>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${taskColumns.length}, fit-content(50%))`,
        }}
      >
        {taskColumns.map((col) => {
          return (
            <PlanColumn
              title={col.title}
              className={col.className}
              key={`plan-col-${col.title}`}
            >
              {col.contents}
            </PlanColumn>
          );
        })}
      </div>
    </div>
  );
};

interface PlanColumnProps {
  title: string;
  className: string | string[] | undefined;
  children: ReactNode;
}

const PlanColumn: FC<PlanColumnProps> = ({ title, className, children }) => {
  return (
    <div className={clsx(className)}>
      <div
        className={clsx(
          "card-subheading",
          "text-size-small",
          "text-style-label",
          "text-style-secondary",
          styles.planCol
        )}
      >
        {title}
      </div>
      {children}
    </div>
  );
};
