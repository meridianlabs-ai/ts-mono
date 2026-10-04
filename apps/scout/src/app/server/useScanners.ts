import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import { ScannerInfo } from "../../types/api-types";

import { scannersQuery } from "./queries";

export const useScanners = (): AsyncData<ScannerInfo[]> => {
  const api = useApi();
  return useAsyncDataFromQuery(scannersQuery(api));
};
