import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import { ActiveScanInfo } from "../../types/api-types";

import { activeScansQuery } from "./queries";

export const useActiveScans = (): AsyncData<Record<string, ActiveScanInfo>> => {
  const api = useApi();
  return useAsyncDataFromQuery(activeScansQuery(api));
};
