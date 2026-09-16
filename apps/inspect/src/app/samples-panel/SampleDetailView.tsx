import { FC, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";

import { navigateAndForget, useUnmount } from "@tsmono/react/hooks";
import { directoryRelativeUrl } from "@tsmono/util";

import { useAppConfig, useLogDir } from "../../app_config";
import { useStore } from "../../state/store";
import { useCurrentLogFile } from "../routing/currentSelection";
import {
  samplesSampleUrl,
  samplesUrl,
  useSamplesRouteParams,
} from "../routing/url";
import { SampleDetailComponent } from "../samples/SampleDetailComponent";

/**
 * Component that displays a single sample in detail view within the samples route.
 * This is shown when navigating to /samples/path/to/file.eval/sample/id/epoch
 *
 * This component handles:
 * - Navigation state calculation using displayedSamples from samples grid
 * - Navigation callbacks (handlePrevious, handleNext)
 *
 * Rendering is delegated to SampleDetailComponent.
 */
export const SampleDetailView: FC = () => {
  const { singleFileMode } = useAppConfig();

  // Get route params
  const {
    samplesPath: routeLogPath,
    sampleId,
    epoch,
    tabId,
  } = useSamplesRouteParams();
  const navigate = useNavigate();

  // The grid remembers its visible order for cross-log navigation.
  const selectedLogFile = useCurrentLogFile();
  const logDir = useLogDir();
  const displayedSamples = useStore(
    (state) => state.logs.samplesListState.displayedSamples
  );

  // Cleanup actions
  const clearSampleTab = useStore((state) => state.appActions.clearSampleTab);

  // Find current sample in displayed samples list
  const currentIndex = useMemo(() => {
    if (!displayedSamples || !selectedLogFile || !sampleId || !epoch) {
      return -1;
    }
    const index = displayedSamples.findIndex((s) => {
      const isMatch =
        String(s.sampleId) === sampleId &&
        s.epoch === parseInt(epoch, 10) &&
        s.logFile === selectedLogFile;
      return isMatch;
    });
    return index;
  }, [displayedSamples, selectedLogFile, sampleId, epoch]);

  const hasPrevious = currentIndex > 0;
  const hasNext =
    displayedSamples &&
    currentIndex >= 0 &&
    currentIndex < displayedSamples.length - 1;

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    if (currentIndex > 0 && displayedSamples && routeLogPath && logDir) {
      const prev = displayedSamples[currentIndex - 1];
      if (!prev) return;
      const relativePath = directoryRelativeUrl(prev.logFile, logDir);
      const url = samplesSampleUrl(
        relativePath,
        prev.sampleId,
        prev.epoch,
        tabId
      );
      navigateAndForget(navigate, url);
    }
  }, [currentIndex, displayedSamples, routeLogPath, logDir, tabId, navigate]);

  const handleNext = useCallback(() => {
    if (
      displayedSamples &&
      currentIndex >= 0 &&
      currentIndex < displayedSamples.length - 1 &&
      routeLogPath &&
      logDir
    ) {
      const next = displayedSamples[currentIndex + 1];
      if (!next) return;
      const relativePath = directoryRelativeUrl(next.logFile, logDir);
      const url = samplesSampleUrl(
        relativePath,
        next.sampleId,
        next.epoch,
        tabId
      );
      navigateAndForget(navigate, url);
    }
  }, [currentIndex, displayedSamples, routeLogPath, logDir, tabId, navigate]);

  useUnmount(clearSampleTab);

  return (
    <SampleDetailComponent
      sampleId={sampleId}
      epoch={epoch}
      tabId={tabId}
      navigation={{
        onPrevious: handlePrevious,
        onNext: handleNext,
        hasPrevious: !!hasPrevious,
        hasNext: !!hasNext,
      }}
      navbarConfig={{
        currentPath: routeLogPath,
        fnNavigationUrl: samplesUrl,
        bordered: true,
        breadcrumbsEnabled: !singleFileMode,
      }}
    />
  );
};
