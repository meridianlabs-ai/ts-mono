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
  const getTabUrl = (tabId: string) =>
    logFile ? logsUrl(logFile, logDir, tabId, prefix) : undefined;
  return {
    selectTab: (tabId: string) => {
      const url = getTabUrl(tabId);
      if (url) navigateAndForget(navigate, url);
    },
    getTabUrl,
  };
};
