import { FC } from "react";

import { NavbarButton } from "../../navbar/NavbarButton";

import { useSamplesView } from "./useSamplesView";

/** Three toolbar toggles (`multiline`, `compactScores`, `colorScalesEnabled`)
 *  share the same shape: read a boolean off the resolved view, render a
 *  latched `NavbarButton`, flip the boolean on click. Parameterise rather
 *  than maintain three near-identical files. */
type ToggleField = "multiline" | "compactScores" | "colorScalesEnabled";

const SETTERS = {
  multiline: "setMultiline",
  compactScores: "setCompactScores",
  colorScalesEnabled: "setColorScalesEnabled",
} as const satisfies Record<ToggleField, string>;

interface SamplesViewToggleProps {
  field: ToggleField;
  icon: string;
  label: string;
}

export const SamplesViewToggle: FC<SamplesViewToggleProps> = ({
  field,
  icon,
  label,
}) => {
  const samplesView = useSamplesView();
  const value = samplesView.view[field];
  const setter = samplesView[SETTERS[field]];
  return (
    <NavbarButton
      label={label}
      icon={icon}
      latched={value}
      subtle
      onClick={() => setter(!value)}
    />
  );
};
