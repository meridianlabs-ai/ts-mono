import { FC, Fragment, useRef, useState } from "react";

import { useScores, useSelectedScores } from "../../state/hooks";
import { useStore } from "../../state/store";
import { ApplicationIcons } from "../appearance/icons";
import { NavbarButton } from "../navbar/NavbarButton";

import { SamplesViewOptionsPopover } from "./list/SamplesViewOptionsPopover";
import { SampleFilter } from "./sample-tools/sample-filter/SampleFilter";
import { SelectScorer } from "./sample-tools/SelectScorer";

interface SampleToolsProps {}

// Multi-sample tools: DSL filter + a single "View" dropdown grouping the
// presentation toggles (multiline, compact scores, colour scales). Scorer
// selection is handled by the column-chooser popover in `SamplesTab`.
export const SampleTools: FC<SampleToolsProps> = () => {
  const [showViewOptions, setShowViewOptions] = useState(false);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <Fragment>
      <SampleFilter />
      <NavbarButton
        ref={viewButtonRef}
        label="View"
        icon={ApplicationIcons.options}
        dropdown
        subtle
        onClick={(e) => {
          e.stopPropagation();
          setShowViewOptions((prev) => !prev);
        }}
      />
      <SamplesViewOptionsPopover
        showing={showViewOptions}
        setShowing={setShowViewOptions}
        positionEl={viewButtonRef.current}
      />
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
