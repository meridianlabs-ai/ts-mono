import { FC, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAppConfig } from "../../app_config";
import { kLogViewSamplesTabId } from "../../constants";
import { useSampleSummaries, useSelectLogFileAction } from "../../state/hooks";
import { useStore } from "../../state/store";
import { useLoadSampleSideEffect } from "../../state/useLoadSampleSideEffect";
import { usePollSampleSideEffect } from "../../state/usePollSampleSideEffect";
import { useLogSampleNavigationActions } from "../routing/sampleNavigation";
import {
  logSamplesUrl,
  logsUrl,
  useLogRouteParams,
  useRoutePrefix,
} from "../routing/url";
import { SampleDetailComponent } from "../samples/SampleDetailComponent";

/**
 * Component that displays a single sample in detail view within the logs route.
 * This is shown when navigating to /logs/path/to/file.eval/samples/sample/id/epoch
 *
 * This component handles:
 * - Log loading (initLogDir, setSelectedLogFile, syncLogs)
 * - Sample selection and loading (useLoadSampleSideEffect, usePollSampleSideEffect)
 * - Navigation state via useLogSampleNavigationActions (respects log filters)
 *
 * Unlike SampleDetailView, this component:
 * - Does NOT clear log state on unmount (user expects to return to same log state)
 * - Uses filteredSamples for navigation (respects current log filters)
 * - Navigates back to log view rather than samples grid
 *
 * Rendering is delegated to SampleDetailComponent.
 */
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

  // Load sample data (depends on selectedLogFile and selectedSampleHandle being set)
  useLoadSampleSideEffect();
  usePollSampleSideEffect();

  const navigate = useNavigate();
  const prefix = useRoutePrefix();

  // Get store state and actions for log loading
  const sampleSummaries = useSampleSummaries();
  const selectLogFile = useSelectLogFileAction();
  const selectSample = useStore((state) => state.logActions.selectSample);

  // Fall back to state for VSCode restored state scenario
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );

  // Use route params if available, otherwise fall back to state
  const logPath = routeLogPath || selectedLogFile;
  const sampleId = routeSampleId || selectedSampleHandle?.id?.toString();
  const epoch = routeEpoch || selectedSampleHandle?.epoch?.toString();

  // Load the log and select the sample when route params change
  // Only run this effect when we have route params (not state fallback)
  useEffect(() => {
    if (routeLogPath && routeSampleId && routeEpoch) {
      selectLogFile(routeLogPath);

      const targetEpoch = parseInt(routeEpoch, 10);
      if (isNaN(targetEpoch)) {
        return;
      }
      selectSample(routeSampleId, targetEpoch, routeLogPath);
    }
  }, [routeLogPath, routeSampleId, routeEpoch, selectLogFile, selectSample]);

  // Handle UUID routes by redirecting to id/epoch URL
  useEffect(() => {
    if (
      logPath &&
      sampleUuid &&
      sampleSummaries &&
      sampleSummaries.length > 0
    ) {
      // Find the sample with the matching UUID
      const sample = sampleSummaries.find((s) => s.uuid === sampleUuid);
      if (sample) {
        const url = logSamplesUrl(
          logPath,
          sample.id,
          sample.epoch,
          sampleTabId,
          prefix
        );
        void navigate(url, { replace: true });
      }
    }
  }, [logPath, sampleUuid, sampleSummaries, sampleTabId, navigate, prefix]);

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
