import { useEffect } from "react";

import { getApi } from "../../app_config";
import { useStore } from "../../state/store";

/**
 * Fetch the flow data for `dir` into the store when it isn't already loaded.
 *
 * Used to trigger side effects only — returns nothing.
 */
export const useFlowServerDataSideEffect = (dir: string) => {
  const api = getApi();
  const flowDir = useStore((state) => state.logs.flowDir);
  const updateFlowData = useStore((state) => state.logsActions.updateFlowData);

  useEffect(() => {
    const fetchFlow = async () => {
      const flowStr = await api.get_flow(dir);

      // Set the flow data into state
      updateFlowData(dir, flowStr);
    };
    if (dir !== flowDir) {
      void fetchFlow();
    }
  }, [dir, flowDir, api, updateFlowData]);
};
