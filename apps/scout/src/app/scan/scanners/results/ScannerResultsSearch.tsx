import { FC, useCallback } from "react";

import { TextInput, type TextInputChange } from "@tsmono/react/components";

import { useStore } from "../../../../state/store";

import styles from "./ScannerResultsSearch.module.css";

export const ScannerResultsSearch: FC = () => {
  const scansSearchText = useStore((state) => state.scansSearchText);
  const setScansSearchText = useStore((state) => state.setScansSearchText);

  const handleChange = useCallback(
    (e: TextInputChange) => {
      setScansSearchText(e.target.value);
    },
    [setScansSearchText]
  );

  return (
    <TextInput
      icon="search"
      value={scansSearchText ?? ""}
      onChange={handleChange}
      placeholder={"Search"}
      className={styles.searchBox}
    />
  );
};
