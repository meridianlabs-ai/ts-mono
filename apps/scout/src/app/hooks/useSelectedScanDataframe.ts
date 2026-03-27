import { skipToken } from "@tanstack/react-query";
import { ColumnTable } from "arquero";

import { AsyncData } from "@tsmono/util";

import { useScanDataframe } from "../server/useScanDataframe";

import { useScanRoute } from "./useScanRoute";
import { useSelectedScan } from "./useSelectedScan";
import { useSelectedScanner } from "./useSelectedScanner";

export const useSelectedScanDataframe = (): AsyncData<ColumnTable> => {
  const { resolvedScansDir, scanPath } = useScanRoute();
  const scanner = useSelectedScanner();
  const selectedScan = useSelectedScan();
  const isComplete = selectedScan.data?.complete;

  return useScanDataframe(
    resolvedScansDir && scanPath && scanner.data
      ? { scansDir: resolvedScansDir, scanPath, scanner: scanner.data }
      : skipToken,
    isComplete
  );
};
