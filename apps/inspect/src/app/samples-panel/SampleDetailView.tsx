import { FC, useMemo } from "react";
import { useNavigate } from "react-router";

import { navigateAndForget, useUnmount } from "@tsmono/react/hooks";
import { directoryRelativeUrl } from "@tsmono/util";

import { useAppConfig, useLogDir } from "../../app_config";
import { useStore } from "../../state/store";
import { useCurrentLogFile } from "../routing/currentSelection";
import {
  samplesSampleUrl,
  samplesUrl,
  toFullUrlMaybe,
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

  // The neighbouring samples' routes, shared by the click handlers and the
  // chevrons' hrefs so a plain click and a new-tab open land in one place.
  const siblingRoute = (offset: number) => {
    if (currentIndex < 0 || !routeLogPath || !logDir) return undefined;
    const sibling = displayedSamples?.[currentIndex + offset];
    if (!sibling) return undefined;
    return samplesSampleUrl(
      directoryRelativeUrl(sibling.logFile, logDir),
      sibling.sampleId,
      sibling.epoch,
      tabId
    );
  };
  const previousRoute = siblingRoute(-1);
  const nextRoute = siblingRoute(1);
  const handlePrevious = () => {
    if (previousRoute) navigateAndForget(navigate, previousRoute);
  };
  const handleNext = () => {
    if (nextRoute) navigateAndForget(navigate, nextRoute);
  };

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
        previousHref: toFullUrlMaybe(previousRoute),
        nextHref: toFullUrlMaybe(nextRoute),
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
