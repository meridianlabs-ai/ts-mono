import { useNavigate } from "react-router";

import { navigateAndForget } from "@tsmono/react/hooks";

import { useLogDir } from "../../app_config";

import { useCurrentLogFile } from "./currentSelection";
import { logsUrl, useRoutePrefix } from "./url";

export const useLogNavigationAction = () => {
  const navigate = useNavigate();
  const logDir = useLogDir();
  const logFile = useCurrentLogFile();
  const prefix = useRoutePrefix();
  return {
    selectTab: (tabId: string) => {
      if (logFile)
        navigateAndForget(navigate, logsUrl(logFile, logDir, tabId, prefix));
    },
  };
};
