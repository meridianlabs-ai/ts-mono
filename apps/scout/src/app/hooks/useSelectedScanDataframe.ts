import { skipToken } from "@tanstack/react-query";
import { ColumnTable } from "arquero";

import { AsyncData } from "@tsmono/util";

import { useScanRoute } from "../../router/useScanRoute";
import { useScanDataframe } from "../server/useScanDataframe";

import { useSelectedScanner } from "./useSelectedScanner";

export const useSelectedScanDataframe = (): AsyncData<ColumnTable> => {
  const { resolvedScansDir, scanPath } = useScanRoute();
  const scanner = useSelectedScanner();

  return useScanDataframe(
    resolvedScansDir && scanPath && scanner.data
      ? {
          scansDir: resolvedScansDir,
          scanPath,
          scanner: scanner.data,
          excludeColumns: ["input", "scan_events"],
        }
      : skipToken
  );
};
