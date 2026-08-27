import { formatPrettyDecimal, isNumeric } from "@tsmono/util";

import { ScoreValue } from "../../../../@types/extraInspect";
import { kScoreTypeList } from "../../../../constants";
import { ScoreDescriptor, SelectedScore } from "../types";

// List score entries come off the wire as numbers, numeric strings, booleans
// or null. Only truthy numerics get the pretty-decimal form; booleans and
// falsy values (0, null, "") keep their String() text, as they always have.
const formatListEntry = (value: unknown): string => {
  if (typeof value === "number" && value) return formatPrettyDecimal(value);
  if (typeof value === "string" && value && isNumeric(value)) {
    return formatPrettyDecimal(parseFloat(value));
  }
  return String(value);
};

// A list score's value is an array; anything else has no length to sort by.
const listLength = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

export const listScoreDescriptor = (_values: ScoreValue[]): ScoreDescriptor => {
  return {
    scoreType: kScoreTypeList,
    filterable: false,
    compare: (a: SelectedScore, b: SelectedScore) => {
      return listLength(a.value) - listLength(b.value);
    },
    render: (score) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (score === null || score === undefined) {
        return "[null]";
      }

      if (!Array.isArray(score)) {
        throw new Error(
          "Unexpected use of list score descriptor for non-list object"
        );
      }
      const formattedScores: string[] = [];
      score.forEach((value: unknown) => {
        formattedScores.push(formatListEntry(value));
      });

      return <div key={`score-value`}>[{formattedScores.join(", ")}]</div>;
    },
  };
};
