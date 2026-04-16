import { skipToken } from "@tanstack/react-query";

import { AsyncData } from "@tsmono/util";

import { ScanResultDetail } from "../../api/api";
import { useScanDataframeDetail } from "../server/useScanDataframeDetail";

import { useScanRoute } from "./useScanRoute";
import { useSelectedScanner } from "./useSelectedScanner";

export const useSelectedScanResultDetail = (
  scanUuid?: string
): AsyncData<ScanResultDetail> => {
  const { resolvedScansDir, scanPath } = useScanRoute();
  const scanner = useSelectedScanner();

  return useScanDataframeDetail(
    resolvedScansDir && scanPath && scanner.data && scanUuid
      ? {
          scansDir: resolvedScansDir,
          scanPath,
          scanner: scanner.data,
          uuid: scanUuid,
        }
      : skipToken
  );
};
