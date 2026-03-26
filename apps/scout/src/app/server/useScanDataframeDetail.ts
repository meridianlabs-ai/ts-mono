import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { ScanResultDetail } from "../../api/api";
import { useApi } from "../../state/store";

type ScanDataframeDetailParams = {
  scansDir: string;
  scanPath: string;
  scanner: string;
  uuid: string;
};

export const useScanDataframeDetail = (
  params: ScanDataframeDetailParams | typeof skipToken
): AsyncData<ScanResultDetail> => {
  const api = useApi();

  return useAsyncDataFromQuery({
    queryKey:
      params === skipToken
        ? [skipToken]
        : ["scanDataframeDetail", params, "scans-inv"],
    queryFn:
      params === skipToken
        ? skipToken
        : () =>
            api.getScannerDataframeDetail(
              params.scansDir,
              params.scanPath,
              params.scanner,
              params.uuid
            ),
    staleTime: Infinity,
  });
};
