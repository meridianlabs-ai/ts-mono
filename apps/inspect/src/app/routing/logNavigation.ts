import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";

import { navigateAndForget } from "@tsmono/react/hooks";

import { useLogDir } from "../../app_config";
import { useStore } from "../../state/store";

import { logsUrl, logsUrlRaw, RoutePrefix, useRoutePrefix } from "./url";

/** Route to a workspace tab of the loaded log, or undefined before it loads. */
const logTabRoute = (
  tabId: string,
  loadedLog: string | undefined,
  logPath: string | undefined,
  logDir: string | undefined,
  prefix: RoutePrefix
): string | undefined => {
  if (!loadedLog) return undefined;
  // Prefer the logPath already in the URL; construct it only as a fallback.
  return logPath
    ? logsUrlRaw(logPath, tabId, prefix)
    : logsUrl(loadedLog, logDir, tabId, prefix);
};

/**
 * Navigate the loaded log to a workspace tab.
 *
 * Used to obtain an action function only — no data, no mount side effects.
 */
export const useLogNavigationAction = () => {
  const navigate = useNavigate();
  const { logPath } = useParams<{ logPath: string }>();
  const logDir = useLogDir();
  const loadedLog = useStore((state) => state.log.loadedLog);
  const prefix = useRoutePrefix();

  const selectTab = useCallback(
    (tabId: string) => {
      const url = logTabRoute(tabId, loadedLog, logPath, logDir, prefix);
      if (url) navigateAndForget(navigate, url);
    },
    [loadedLog, logPath, logDir, navigate, prefix]
  );

  const getTabUrl = (tabId: string) =>
    logTabRoute(tabId, loadedLog, logPath, logDir, prefix);

  return {
    selectTab,
    getTabUrl,
  };
};
