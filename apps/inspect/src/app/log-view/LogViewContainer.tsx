import { FC, useEffect } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";

import { kLogViewSamplesTabId } from "../../constants";
import { useStore } from "../../state/store";
import { useSampleUuidRedirectUrl } from "../routing/sampleNavigation";
import { useLogRouteParams, type RoutePrefix } from "../routing/url";

import { LogViewLayout } from "./LogViewLayout";

/**
 * LogContainer component that handles routing to specific logs and tabs.
 * Sample detail URLs are now handled by LogSampleDetailView.
 */
export const LogViewContainer: FC = () => {
  const { logPath, tabId, sampleUuid, sampleTabId } = useLogRouteParams();

  const setWorkspaceTab = useStore((state) => state.appActions.setWorkspaceTab);

  const location = useLocation();
  const prefix: RoutePrefix = location.pathname.startsWith("/tasks/")
    ? "/tasks"
    : "/logs";
  const [searchParams] = useSearchParams();

  // Canonicalize a sampleUuid route to its id/epoch URL once resolvable.
  const sampleUuidRedirectUrl = useSampleUuidRedirectUrl({
    logPath,
    sampleUuid,
    sampleTabId,
    prefix,
  });

  // Workspace tab consumers still use UI state; active log/sample identity
  // already comes directly from routing.
  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (!logPath) return;
    setWorkspaceTab(tabId ?? kLogViewSamplesTabId);
  }, [logPath, tabId, setWorkspaceTab]);

  if (sampleUuidRedirectUrl) {
    const search = searchParams.toString();
    return (
      <Navigate
        to={
          search ? `${sampleUuidRedirectUrl}?${search}` : sampleUuidRedirectUrl
        }
        replace
      />
    );
  }

  return <LogViewLayout />;
};
