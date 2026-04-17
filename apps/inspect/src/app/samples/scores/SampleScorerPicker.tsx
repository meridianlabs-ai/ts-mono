import { FC, useMemo } from "react";

import { ToolDropdownButton } from "@tsmono/react/components";

import { ApplicationIcons } from "../../appearance/icons";

interface SampleScorerPickerProps {
  scorers: string[];
  selectedScorer: string;
  onChange: (scorer: string) => void;
}

export const SampleScorerPicker: FC<SampleScorerPickerProps> = ({
  scorers,
  selectedScorer,
  onChange,
}) => {
  const items = useMemo(() => {
    return scorers.reduce<Record<string, () => void>>((acc, scorer) => {
      acc[scorer] = () => onChange(scorer);
      return acc;
    }, {});
  }, [scorers, onChange]);

  return (
    <ToolDropdownButton
      label={selectedScorer}
      icon={ApplicationIcons.scorer}
      items={items}
    />
  );
};
