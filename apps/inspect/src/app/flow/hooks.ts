import { useEffect } from "react";

import { useStore } from "../../state/store";
import { useAppConfig } from "../server/useAppConfig";

export const useFlowServerData = (dir: string) => {
  const { api } = useAppConfig();
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
