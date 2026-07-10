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
    render: (score) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- score values come from eval logs and can be null despite the declared ScoreValue type
      if (score === null || score === undefined) {
        return "[null]";
      }

      const formattedScores: string[] = [];
      (score as []).forEach((value) => {
        if (!Array.isArray(score)) {
          throw new Error(
            "Unexpected use of list score descriptor for non-lisß object"
          );
        }
        const formattedValue =
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the `[]` cast types elements as never; runtime list entries come from log score values and can be nullish
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
