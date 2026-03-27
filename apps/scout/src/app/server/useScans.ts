import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import { ScanRow } from "../../types/api-types";

// Lists the available scans from the server and stores in state
export const useScans = (
  scansDir: string,
  options?: { refetchInterval?: number | false }
): AsyncData<ScanRow[]> => {
  const api = useApi();

  return useAsyncDataFromQuery({
    queryKey: ["scans", scansDir, "scans-inv"],
    queryFn: async () => (await api.getScans(scansDir)).items,
    staleTime: 5000,
    refetchInterval: options?.refetchInterval ?? 5000,
  });
};
