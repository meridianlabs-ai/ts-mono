import { FC } from "react";

import { useScores, useSelectedScores } from "../../state/hooks";
import { useStore } from "../../state/store";

import { SampleFilter } from "./sample-tools/sample-filter/SampleFilter";
import { SelectScorer } from "./sample-tools/SelectScorer";

interface SampleToolsProps {}

// Multi-sample tools. Scorer selection is handled by the column-chooser
// popover in `SamplesTab`, so only the DSL filter lives here.
export const SampleTools: FC<SampleToolsProps> = () => {
  return <SampleFilter />;
};

interface ScoreFilterToolsProps {}

export const ScoreFilterTools: FC<ScoreFilterToolsProps> = () => {
  const scores = useScores();
  const selectedScores = useSelectedScores();
  const setSelectedScores = useStore(
    (state) => state.logActions.setSelectedScores
  );
  if (scores.length <= 1) {
    return undefined;
  }
  return (
    <SelectScorer
      scores={scores}
      selectedScores={selectedScores}
      setSelectedScores={setSelectedScores}
    />
  );
};
