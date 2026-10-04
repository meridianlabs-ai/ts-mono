import clsx from "clsx";
import React, { useEffect } from "react";

import { ErrorPanel, LoadingBar } from "@tsmono/react/components";
import { useDocumentTitle } from "@tsmono/react/hooks";

import { useScannerParam } from "../../router/useScannerParam";
import { useScanRoute } from "../../router/useScanRoute";
import { useStore } from "../../state/store";
import { ScansNavbar } from "../components/ScansNavbar";
import { useSelectedScan } from "../hooks/useSelectedScan";
import { useAppConfig } from "../server/useAppConfig";
import { getScanDisplayName } from "../utils/scan";
import { useScansDir } from "../utils/useScansDir";

import styles from "./ScanPanel.module.css";
import { ScanPanelBody } from "./ScanPanelBody";
import { ScanPanelTitle } from "./ScanPanelTitle";

export const ScanPanel: React.FC = () => {
  const config = useAppConfig();
  const scansDir = config.scans.dir;
  const { displayScansDir, resolvedScansDirSource, setScansDir } =
    useScansDir(true);
  // Load server data
  const { loading, data: selectedScan, error } = useSelectedScan();

  // Set document title with scan location
  useDocumentTitle(getScanDisplayName(selectedScan, scansDir), "Scans");

  // Clear scan state when viewing a different scan, but preserve it on back-nav
  // to the same scan (so search text, sort, grouping survive round-trips).
  const { scanPath } = useScanRoute();
  const selectedScanLocation = useStore((state) => state.selectedScanLocation);
  const clearScanState = useStore((state) => state.clearScanState);
  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (scanPath !== selectedScanLocation) {
      clearScanState();
    }
  }, [scanPath, selectedScanLocation, clearScanState]);

  useScannerParam();
  return (
    <div className={clsx(styles.root)}>
      <ScansNavbar
        scansDir={displayScansDir}
        scansDirSource={resolvedScansDirSource}
        setScansDir={setScansDir}
      />
      <LoadingBar loading={!!loading} />
      {error && <ErrorPanel title="Error Loading Scan" error={error} />}
      {!error && selectedScan && (
        <>
          <ScanPanelTitle resultsDir={scansDir} selectedScan={selectedScan} />
          <ScanPanelBody selectedScan={selectedScan} />
        </>
      )}
    </div>
  );
};
