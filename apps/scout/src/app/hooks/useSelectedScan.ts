import { skipToken } from "@tanstack/react-query";

import { useMirrorToStore } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useScanRoute } from "../../router/useScanRoute";
import { useStore } from "../../state/store";
import { Status } from "../../types/api-types";
import { useScan } from "../server/useScan";

export const useSelectedScan = (): AsyncData<Status> => {
  const { resolvedScansDir, scanPath } = useScanRoute();

  // Remember the scan being viewed so the last route can be restored
  // (see useRestoreLastRoute). Routes without a scan yield "".
  const setSelectedScanLocation = useStore(
    (state) => state.setSelectedScanLocation
  );
  useMirrorToStore(scanPath || undefined, setSelectedScanLocation);

  return useScan(
    resolvedScansDir && scanPath
      ? { scansDir: resolvedScansDir, scanPath }
      : skipToken
  );
};
