import { ScoreValue } from "../../../../@types/extraInspect";
import { ScoreDescriptor } from "../types";

import { booleanScoreDescriptor } from "./BooleanScoreDescriptor";
import { categoricalScoreDescriptor } from "./CategoricalScoreDescriptor";
import { listScoreDescriptor } from "./ListScoreDescriptor";
import { numericScoreDescriptor } from "./NumericScoreDescriptor";
import { objectScoreDescriptor } from "./ObjectScoreDescriptor";
import { otherScoreDescriptor } from "./OtherScoreDescriptor";
import { passFailScoreDescriptor } from "./PassFailScoreDescriptor";

type ScorerTypes = string | number | boolean | object;
interface ScoreCategorizer {
  describe: (
    values: ScoreValue[],
    types?: ScorerTypes[]
  ) => ScoreDescriptor | undefined;
}

export const getScoreDescriptorForValues = (
  uniqScoreValues: ScoreValue[],
  uniqScoreTypes: ScorerTypes[]
): ScoreDescriptor | undefined => {
  for (const categorizer of scoreCategorizers) {
    const scoreDescriptor = categorizer.describe(
      uniqScoreValues,
      uniqScoreTypes
    );
    if (scoreDescriptor) {
      return scoreDescriptor;
    }
  }
  return undefined;
};

const scoreCategorizers: ScoreCategorizer[] = [
  {
    describe: (_values: ScoreValue[], types?: ScorerTypes[]) => {
      if (types && types.length === 1 && types[0] === "boolean") {
        return booleanScoreDescriptor();
      }
      return undefined;
    },
  },
  {
    describe: (values: ScoreValue[]) => {
      if (
        values.length === 2 &&
        values.every((val) => {
          return val === 1 || val === 0;
        })
      ) {
        return numericScoreDescriptor(values);
      }
      return undefined;
    },
  },
  {
    describe: (values: ScoreValue[], types?: ScorerTypes[]) => {
      if (
        types &&
        types[0] === "string" &&
        types.length === 1 &&
        values.length < 5 &&
        !values.find((val) => {
          return val !== "I" && val !== "C" && val !== "P" && val !== "N";
        })
      ) {
        return passFailScoreDescriptor(values);
      }
      return undefined;
    },
  },
  {
    describe: (values: ScoreValue[], types?: ScorerTypes[]) => {
      if (
        values.length < 10 &&
        types &&
        types.length === 1 &&
        types[0] === "string"
      ) {
        return categoricalScoreDescriptor(values);
      }
      return undefined;
    },
  },
  {
    describe: (values: ScoreValue[], types?: ScorerTypes[]) => {
      if (types && types.length === 1 && types[0] === "number") {
        return numericScoreDescriptor(values);
      }
      return undefined;
    },
  },
  {
    describe: (values: ScoreValue[], types?: ScorerTypes[]) => {
      if (types && types.length === 1 && types[0] === "object") {
        if (values.length > 0 && values.every(Array.isArray)) {
          return listScoreDescriptor();
        } else if (values.every((value) => !Array.isArray(value))) {
          return objectScoreDescriptor(values);
        }
      }
      return undefined;
    },
  },
  {
    describe: () => {
      return otherScoreDescriptor();
    },
  },
];
