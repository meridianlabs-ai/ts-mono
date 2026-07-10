import { formatPrettyDecimal, isNumeric } from "@tsmono/util";

import { ScoreValue } from "../../../../@types/extraInspect";
import { kScoreTypeList } from "../../../../constants";
import { ScoreDescriptor, SelectedScore } from "../types";

export const listScoreDescriptor = (_values: ScoreValue[]): ScoreDescriptor => {
  return {
    scoreType: kScoreTypeList,
    filterable: false,
    compare: (a: SelectedScore, b: SelectedScore) => {
      return (
        (a.value as unknown as unknown[]).length -
        (b.value as unknown as unknown[]).length
      );
    },
    render: (score: ScoreValue | null | undefined) => {
      if (score === null || score === undefined) {
        return "[null]";
      }

      if (!Array.isArray(score)) {
        throw new Error(
          "Unexpected use of list score descriptor for non-lisß object"
        );
      }

      const formattedScores: string[] = [];
      score.forEach((value) => {
        const formattedValue =
          value && isNumeric(value)
            ? formatPrettyDecimal(
                typeof value === "number"
                  ? value
                  : parseFloat(value === true ? "1" : value)
              )
            : String(value);
        formattedScores.push(formattedValue);
      });

      return <div key={`score-value`}>[{formattedScores.join(", ")}]</div>;
    },
  };
};
