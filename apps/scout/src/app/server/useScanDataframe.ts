import { skipToken } from "@tanstack/react-query";
import { ColumnTable } from "arquero";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";

import { ScanDataframeParams, scanDataframeQuery } from "./queries";

// Fetches scanner dataframe from the server by location and scanner
export const useScanDataframe = (
  params: ScanDataframeParams | typeof skipToken
): AsyncData<ColumnTable> => {
  const api = useApi();
  return useAsyncDataFromQuery(scanDataframeQuery(api, params));
};
