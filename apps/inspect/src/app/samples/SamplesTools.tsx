import { FC, Fragment } from "react";

import { useScores, useSelectedScores } from "../../state/hooks";
import { useStore } from "../../state/store";

import { CompactScoresToggle } from "./list/CompactScoresToggle";
import { MultilineToggle } from "./list/MultilineToggle";
import { SampleFilter } from "./sample-tools/sample-filter/SampleFilter";
import { SelectScorer } from "./sample-tools/SelectScorer";

interface SampleToolsProps {}

// Multi-sample tools: DSL filter + row-layout (multiline) toggle +
// compact-scores toggle. Scorer selection is handled by the
// column-chooser popover in `SamplesTab`.
export const SampleTools: FC<SampleToolsProps> = () => {
  return (
    <Fragment>
      <SampleFilter />
      <MultilineToggle />
      <CompactScoresToggle />
    </Fragment>
  );
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
