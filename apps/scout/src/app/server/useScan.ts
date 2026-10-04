import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import { Status } from "../../types/api-types";

import { ScanParams, scanQuery } from "./queries";

// Fetches scan status from the server by location
export const useScan = (
  params: ScanParams | typeof skipToken
): AsyncData<Status> => {
  const api = useApi();
  return useAsyncDataFromQuery(scanQuery(api, params));
};
