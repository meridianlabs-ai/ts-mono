import { skipToken } from "@tanstack/react-query";
import { useEffect } from "react";

import { AsyncData } from "@tsmono/util";

import { useStore } from "../../state/store";
import { Status } from "../../types/api-types";
import { useScan } from "../server/useScan";

import { useScanRoute } from "./useScanRoute";

export const useSelectedScan = (): AsyncData<Status> => {
  const { resolvedScansDir, scanPath } = useScanRoute();

  // Set selectedScanLocation for nav restoration
  const setSelectedScanLocation = useStore(
    (state) => state.setSelectedScanLocation
  );
  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (scanPath) {
      setSelectedScanLocation(scanPath);
    }
  }, [scanPath, setSelectedScanLocation]);

  return useScan(
    resolvedScansDir && scanPath
      ? { scansDir: resolvedScansDir, scanPath }
      : skipToken
  );
};
