import { FC } from "react";

import { ApplicationIcons } from "../../appearance/icons";
import { NavbarButton } from "../../navbar/NavbarButton";

import { useSamplesView } from "./useSamplesView";

export const CompactScoresToggle: FC = () => {
  const { view, setCompactScores } = useSamplesView();
  return (
    <NavbarButton
      key="compact-scores"
      label="Compact scores"
      icon={ApplicationIcons["compact-scores"]}
      latched={view.compactScores}
      subtle
      onClick={() => setCompactScores(!view.compactScores)}
    />
  );
};
