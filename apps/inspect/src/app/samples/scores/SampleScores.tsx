import { FC } from "react";

import { EvalSampleScore } from "../../../@types/extraInspect";
import { getScoreDescriptorForValues } from "../descriptor/score/ScoreDescriptor";

interface SampleScoresProps {
  scores: EvalSampleScore;
  scorer: string;
}

export const SampleScores: FC<SampleScoresProps> = ({ scores, scorer }) => {
  const scoreData = scores?.[scorer];
  if (!scoreData) {
    return undefined;
  }

  const scorerDescriptor = getScoreDescriptorForValues(
    [scoreData.value],
    [typeof scoreData.value]
  );
  return scorerDescriptor?.render(scoreData.value);
};
