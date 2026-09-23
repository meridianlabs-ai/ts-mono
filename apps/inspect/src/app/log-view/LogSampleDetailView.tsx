import { FC, useCallback } from "react";
import { Navigate } from "react-router";

import { useAppConfig } from "../../app_config";
import { kLogViewSamplesTabId } from "../../constants";
import {
  useLogSampleNavigationActions,
  useSampleUuidRedirectUrl,
} from "../routing/sampleNavigation";
import { logsUrl, useLogRouteParams, useRoutePrefix } from "../routing/url";
import { SampleDetailComponent } from "../samples/SampleDetailComponent";

/** Log-relative sample navigation, preserving the current log's filters. */
export const LogSampleDetailView: FC = () => {
  // Get route params
  const {
    logPath: routeLogPath,
    sampleId: routeSampleId,
    epoch: routeEpoch,
    sampleTabId,
    sampleUuid,
  } = useLogRouteParams();

  const { singleFileMode } = useAppConfig();

  const prefix = useRoutePrefix();

  const logPath = routeLogPath;
  const sampleId = routeSampleId;
  const epoch = routeEpoch;

  // Canonicalize a sampleUuid route to its id/epoch URL once resolvable.
  const sampleUuidRedirectUrl = useSampleUuidRedirectUrl({
    logPath,
    sampleUuid,
    sampleTabId,
    prefix,
  });

  // Get navigation handlers from the hook
  const { onPrevious, onNext, hasPrevious, hasNext } =
    useLogSampleNavigationActions();

  // Custom navigation URL function for breadcrumbs and back button.
  // We use currentPath = `${logPath}/sample` so the log file becomes clickable.
  // - Back button: dirname of "logPath/sample" is "logPath", goes to log's samples tab
  // - Home button: goes to root
  // - Log file breadcrumb: goes to log's samples tab
  // - Parent folder breadcrumbs: go to those folders
  const fnNavigationUrl = useCallback(
    (file: string, log_dir?: string) => {
      if (!logPath || !file) {
        // Empty file = home button, go to root
        return logsUrl(file, log_dir, undefined, prefix);
      }

      // Normalize: remove trailing slash for comparison
      const normalizedFile = file.endsWith("/") ? file.slice(0, -1) : file;

      // If clicking the log file itself or the virtual "sample" path,
      // go to log's samples tab
      if (
        normalizedFile === logPath ||
        normalizedFile === `${logPath}/sample`
      ) {
        return logsUrl(logPath, log_dir, kLogViewSamplesTabId, prefix);
      }

      // Otherwise, use the route-appropriate URL (for parent folders / back)
      return logsUrl(file, log_dir, undefined, prefix);
    },
    [logPath, prefix]
  );

  if (sampleUuidRedirectUrl) {
    return <Navigate to={sampleUuidRedirectUrl} replace />;
  }

  return (
    <SampleDetailComponent
      sampleId={sampleId}
      epoch={epoch}
      tabId={sampleTabId}
      navigation={{
        onPrevious,
        onNext,
        hasPrevious,
        hasNext,
      }}
      navbarConfig={{
        // Add sample identifier to path so log file becomes clickable
        // (breadcrumbs don't make the last segment a link)
        currentPath: logPath ? `${logPath}/sample` : undefined,
        fnNavigationUrl,
        bordered: true,
        breadcrumbsEnabled: !singleFileMode,
      }}
    />
  );
};
