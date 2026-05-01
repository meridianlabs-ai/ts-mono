import clsx from "clsx";
import { FC } from "react";

import { ScoreLabel } from "../../../app/types";
import { BasicSampleData } from "../../../client/api/types";
import { EvalDescriptor } from "../descriptor/types";

import styles from "./ScoreCompact.module.css";
import { ScoreValueDisplay } from "./ScoreValueDisplay";

interface ScoreCompactProps {
  scores: ScoreLabel[];
  sample: BasicSampleData;
  evalDescriptor: EvalDescriptor;
}

/**
 * Inline score display used when there are 1–2 scores. Each score
 * gets a small uppercase label above its rendered value, side by side.
 * Acts as the right-column body when no panel chrome is needed.
 */
export const ScoreCompact: FC<ScoreCompactProps> = ({
  scores,
  sample,
  evalDescriptor,
}) => {
  return (
    <div className={styles.row}>
      {scores.map((scoreLabel) => {
        const selected = evalDescriptor.score(sample, scoreLabel);
        const descriptor = evalDescriptor.scoreDescriptor(scoreLabel);
        const label = scores.length === 1 ? "Score" : scoreLabel.name;
        return (
          <div
            key={`${scoreLabel.scorer}-${scoreLabel.name}`}
            className={styles.cell}
            title={scoreLabel.name}
          >
            <span
              className={clsx(styles.label, "text-style-secondary")}
              data-unsearchable={true}
            >
              {label}
            </span>
            <ScoreValueDisplay
              value={selected?.value}
              scoreType={descriptor.scoreType}
              size={22}
            />
          </div>
        );
      })}
    </div>
  );
};
