import { FC } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";

import { useSampleUuidRedirectUrl } from "../routing/sampleNavigation";
import { useLogRouteParams, type RoutePrefix } from "../routing/url";

import { LogViewLayout } from "./LogViewLayout";

/**
 * LogContainer component that handles routing to specific logs and tabs.
 * Sample detail URLs are now handled by LogSampleDetailView.
 */
export const LogViewContainer: FC = () => {
  const { logPath, sampleUuid, sampleTabId } = useLogRouteParams();

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
