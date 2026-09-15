import { valueAsString } from "@tsmono/util";

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
      return valueAsString(a.value).localeCompare(valueAsString(b.value));
    },
    render: (score) => {
      return valueAsString(score);
    },
  };
};
