import clsx from "clsx";

import { ScoreValueOrUnchanged } from "../../../../@types/bogusTypes";
import { ScoreDescriptor, SelectedScore } from "../types";

import styles from "./BooleanScoreDescriptor.module.css";

export const booleanScoreDescriptor = (): ScoreDescriptor => {
  return {
    scoreType: "boolean",
    compare: (a: SelectedScore, b: SelectedScore) => {
      return Number(a.value) - Number(b.value);
    },
    render: (score: ScoreValueOrUnchanged) => {
      return (
        <span
          className={clsx(
            styles.circle,
            "text-size-small",
            score ? styles.green : styles.red
          )}
        >
          {String(score)}
        </span>
      );
    },
  };
};
