import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import { Status } from "../../types/api-types";

import { finishedScanQuery, ScanParams } from "./queries";

export const useFinishedScan = (
  params: ScanParams | typeof skipToken
): AsyncData<Status> => {
  const api = useApi();
  return useAsyncDataFromQuery(finishedScanQuery(api, params));
};
