import { clsx } from "clsx";
import { FC, useState } from "react";

import { useDocumentTitle } from "@tsmono/react/hooks";

import { Status } from "../../types/api-types";
import { useScansDir } from "../utils/useScansDir";

import { ActiveScanView } from "./ActiveScanView";
import { DefineScannerSection } from "./DefineScannerSection";
import styles from "./RunScanPanel.module.css";

export const RunScanPanel: FC = () => {
  useDocumentTitle("Run Scan");

  const { resolvedScansDir } = useScansDir();
  const [startedScan, setStartedScan] = useState<Status>();
  return (
    <div className={clsx(styles.container)}>
      <DefineScannerSection onScanStarted={setStartedScan} />
      <ActiveScanView
        key={startedScan?.spec.scan_id}
        scan={startedScan}
        scansDir={resolvedScansDir}
        onDismiss={() => setStartedScan(undefined)}
      />
    </div>
  );
};
