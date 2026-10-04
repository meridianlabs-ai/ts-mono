import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { ScanResultDetail } from "../../api/api";
import { useApi } from "../../state/store";

import { ScanDataframeDetailParams, scanDataframeDetailQuery } from "./queries";

export const useScanDataframeDetail = (
  params: ScanDataframeDetailParams | typeof skipToken
): AsyncData<ScanResultDetail> => {
  const api = useApi();
  return useAsyncDataFromQuery(scanDataframeDetailQuery(api, params));
};
