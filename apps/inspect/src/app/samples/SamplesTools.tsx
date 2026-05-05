import { FC, Fragment } from "react";

import { useScores, useSelectedScores } from "../../state/hooks";
import { useStore } from "../../state/store";
import { ApplicationIcons } from "../appearance/icons";

import { SamplesViewToggle } from "./list/SamplesViewToggle";
import { useSamplesViewScoreColorScales } from "./list/useSamplesView";
import { SampleFilter } from "./sample-tools/sample-filter/SampleFilter";
import { SelectScorer } from "./sample-tools/SelectScorer";

interface SampleToolsProps {}

// Multi-sample tools: DSL filter + row-layout (multiline) toggle +
// compact-scores + colour-scales toggles. Scorer selection is handled
// by the column-chooser popover in `SamplesTab`. The colour-scales
// toggle hides itself when the eval has no `score_color_scales` —
// flipping it has no visible effect otherwise.
export const SampleTools: FC<SampleToolsProps> = () => {
  const scoreColorScales = useSamplesViewScoreColorScales();
  const showColorScales = Object.keys(scoreColorScales).length > 0;
  return (
    <Fragment>
      <SampleFilter />
      <SamplesViewToggle
        field="multiline"
        label="Multiline"
        icon={ApplicationIcons["list-wrap"]}
      />
      <SamplesViewToggle
        field="compactScores"
        label="Compact scores"
        icon={ApplicationIcons["compact-scores"]}
      />
      {showColorScales && (
        <SamplesViewToggle
          field="colorScalesEnabled"
          label="Score colors"
          icon={ApplicationIcons["color-scales"]}
        />
      )}
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
