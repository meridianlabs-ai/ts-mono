import clsx from "clsx";
import { FC } from "react";

import type { JsonValue } from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

import { ScoreValue } from "../components/ScoreValue";
import { valueAsString } from "../utils/format";

import styles from "./ScoreColumn.module.css";

interface ScoreColumnProps {
  score: JsonValue;
  labelClassName?: string;
  valueClassName?: string;
  onShowAllScores?: () => void;
}

export const ScoreColumn: FC<ScoreColumnProps> = ({
  score,
  labelClassName,
  valueClassName,
  onShowAllScores,
}) => {
  const isComplex = isRecord(score);
  const totalScores = isComplex ? Object.keys(score).length : 0;

  const kMaxPreviewRows = 3;

  return (
    <div className={styles.scoreColumn}>
      <span className={clsx(labelClassName)}>Score</span>
      <span className={clsx(valueClassName, isComplex && styles.scoreGrid)}>
        <ScoreValue
          score={score}
          maxRows={kMaxPreviewRows}
          expandable={false}
        />
      </span>
      {isComplex && totalScores > kMaxPreviewRows && onShowAllScores && (
        <button
          type="button"
          className={styles.allScoresLink}
          onClick={onShowAllScores}
        >
          All scores ({totalScores})
        </button>
      )}
    </div>
  );
};

/** Compact inline score for the collapsed bar. */
export const CollapsedScore: FC<{
  score: JsonValue;
  onShowAllScores?: () => void;
}> = ({ score, onShowAllScores }) => {
  const isComplex = isRecord(score);

  if (isComplex && onShowAllScores) {
    return (
      <button
        type="button"
        className={styles.allScoresLink}
        onClick={onShowAllScores}
      >
        All scores ({Object.keys(score).length})
      </button>
    );
  }

  return (
    <span className={styles.collapsedSimpleScore}>
      Score: {valueAsString(score)}
    </span>
  );
};
