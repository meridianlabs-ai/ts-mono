import clsx from "clsx";
import { ChangeEvent, FC, useCallback } from "react";

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
    (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value),
    [onChange]
  );

  return (
    <div className={styles.picker}>
      <span className={clsx("text-size-smaller", "text-style-secondary")}>
        scanner:
      </span>
      <select
        className={clsx(
          "form-select",
          "form-select-sm",
          "text-size-smaller",
          styles.select
        )}
        aria-label="Select scanner"
        value={selected}
        onChange={handleChange}
      >
        {scanners.map((scanner) => (
          <option key={scanner} value={scanner}>
            {scanner}
          </option>
        ))}
      </select>
    </div>
  );
};
