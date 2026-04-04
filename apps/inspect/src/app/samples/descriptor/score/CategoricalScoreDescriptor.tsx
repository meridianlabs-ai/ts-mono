import { ScoreValue } from "../../../../@types/extraInspect";
import { kScoreTypeCategorical } from "../../../../constants";
import { ScoreDescriptor } from "../types";

export const categoricalScoreDescriptor = (
  values: ScoreValue[]
): ScoreDescriptor => {
  return {
    scoreType: kScoreTypeCategorical,
    categories: values,
    compare: (a, b) => {
      return String(a.value).localeCompare(String(b.value));
    },
    render: (score) => {
      return String(score);
    },
  };
};
