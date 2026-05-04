import { FC } from "react";

import { ApplicationIcons } from "../../appearance/icons";
import { NavbarButton } from "../../navbar/NavbarButton";

import { useSamplesView } from "./useSamplesView";

export const MultilineToggle: FC = () => {
  const { view, setMultiline } = useSamplesView();
  return (
    <NavbarButton
      key="multiline"
      label="Multiline"
      icon={ApplicationIcons["list-wrap"]}
      latched={view.multiline}
      subtle
      onClick={() => setMultiline(!view.multiline)}
    />
  );
};
