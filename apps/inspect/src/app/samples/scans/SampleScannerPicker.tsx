import { FC, useMemo } from "react";

import { ToolDropdownButton } from "@tsmono/react/components";

import { ApplicationIcons } from "../../appearance/icons";

interface SampleScannerPickerProps {
  scanners: string[];
  selected: string;
  onChange: (scanner: string) => void;
}

export const SampleScannerPicker: FC<SampleScannerPickerProps> = ({
  scanners,
  selected,
  onChange,
}) => {
  const items = useMemo(() => {
    return scanners.reduce<Record<string, () => void>>((acc, scanner) => {
      acc[scanner] = () => onChange(scanner);
      return acc;
    }, {});
  }, [scanners, onChange]);

  return (
    <ToolDropdownButton
      label={selected}
      icon={ApplicationIcons.scorer}
      items={items}
      dropdownClassName="text-size-small"
    />
  );
};
