import { FC } from "react";

import { ApplicationIcons } from "../../appearance/icons";
import { NavbarButton } from "../../navbar/NavbarButton";

import {
  useSamplesView,
  useSamplesViewScoreColorScales,
} from "./useSamplesView";

/**
 * Toolbar toggle for the score-cell colour-scale heatmap. Only
 * renders when the eval has at least one entry in
 * `score_color_scales` — there's no point exposing the toggle
 * otherwise since flipping it has no visible effect.
 */
export const ColorScalesToggle: FC = () => {
  const { view, setColorScalesEnabled } = useSamplesView();
  const scoreColorScales = useSamplesViewScoreColorScales();

  if (Object.keys(scoreColorScales).length === 0) return null;

  return (
    <NavbarButton
      key="color-scales"
      label="Score colors"
      icon={ApplicationIcons["color-scales"]}
      latched={view.colorScalesEnabled}
      subtle
      onClick={() => setColorScalesEnabled(!view.colorScalesEnabled)}
    />
  );
};
