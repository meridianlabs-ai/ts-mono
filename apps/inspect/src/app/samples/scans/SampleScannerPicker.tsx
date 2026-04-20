import {
  VscodeOption,
  VscodeSingleSelect,
} from "@vscode-elements/react-elements";
import clsx from "clsx";
import { FC, useCallback } from "react";

import styles from "./SampleScannerPicker.module.css";

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
  const handleChange = useCallback(
    (e: Event) => {
      const value = (e.target as { value?: string } | null)?.value;
      if (typeof value === "string") onChange(value);
    },
    [onChange]
  );

  return (
    <div className={styles.picker}>
      <span className={clsx("text-size-smaller", "text-style-secondary")}>
        scanner:
      </span>
      <VscodeSingleSelect value={selected} onChange={handleChange}>
        {scanners.map((scanner) => (
          <VscodeOption key={scanner} value={scanner}>
            {scanner}
          </VscodeOption>
        ))}
      </VscodeSingleSelect>
    </div>
  );
};
