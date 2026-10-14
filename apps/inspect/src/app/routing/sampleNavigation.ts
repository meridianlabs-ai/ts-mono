import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { navigateAndForget } from "@tsmono/react/hooks";
import { directoryRelativeUrl } from "@tsmono/util";

import { useLogDir } from "../../app_config";
import type { SampleSummary } from "../../client/api/types";
import {
  useFilteredSamples,
  useSelectedSampleSummaries,
} from "../../state/hooks";
import { sampleIdsEqual } from "../shared/sample";

import { useCurrentSampleHandle } from "./currentSelection";
import {
  logSamplesUrl,
  samplesSampleUrl,
  toFullUrlMaybe,
  useLogOrSampleRouteParams,
  useLogRouteParams,
  useRoutePrefix,
  type RoutePrefix,
} from "./url";

/**
 * Resolves a `sampleUuid` route to its canonical id/epoch sample URL once the
 * selected log's summaries have loaded. Returns undefined while unresolvable
 * (no uuid in play, summaries still loading, or no matching sample) so
 * callers render normally until a declarative `<Navigate replace>` applies.
 */
export const useSampleUuidRedirectUrl = (opts: {
  logPath: string | undefined;
  sampleUuid: string | undefined;
  sampleTabId: string | undefined;
  prefix: RoutePrefix;
}): string | undefined => {
  const { logPath, sampleUuid, sampleTabId, prefix } = opts;
  const sampleSummaries = useSelectedSampleSummaries();
  if (!logPath || !sampleUuid) return undefined;
  const sample = sampleSummaries.data?.find((s) => s.uuid === sampleUuid);
  return sample
    ? logSamplesUrl(logPath, sample.id, sample.epoch, sampleTabId, prefix)
    : undefined;
};

/**
 * Hook that provides sample navigation utilities with proper URL handling
 * for use across the application
 *
 * Used to obtain action functions (plus their enablement flags) —
 * no mount side effects.
 */
export const useSampleNavigationActions = () => {
  const navigate = useNavigate();
  const prefix = useRoutePrefix();

  const { logPath, sampleTabId } = useLogRouteParams();

  // Navigate to a specific sample with index
  const showSample = useCallback(
    (id: string | number, epoch: number, specifiedSampleTabId?: string) => {
      const resolvedPath = logPath;

      if (resolvedPath) {
        // Use specified sampleTabId if provided, otherwise use current sampleTabId from URL params
        const currentSampleTabId = specifiedSampleTabId || sampleTabId;

        const url = logSamplesUrl(
          resolvedPath,
          id,
          epoch,
          currentSampleTabId,
          prefix
        );

        // Navigate to the sample URL (now goes to LogSampleDetailView)
        navigateAndForget(navigate, url);
      }
    },
    [logPath, navigate, sampleTabId, prefix]
  );

  // Get a sample URL for a specific sample
  const getSampleUrl = useCallback(
    (
      sampleId: string | number,
      epoch: number,
      specificSampleTabId?: string
    ) => {
      const resolvedPath = logPath;
      if (resolvedPath) {
        const currentSampleTabId = specificSampleTabId || sampleTabId;
        const url = logSamplesUrl(
          resolvedPath,
          sampleId,
          epoch,
          currentSampleTabId,
          prefix
        );
        return `#${url}`;
      }
      return undefined;
    },
    [logPath, sampleTabId, prefix]
  );

  return { showSample, getSampleUrl };
};

export const useSampleDetailNavigation = () => {
  const [searchParams, _setSearchParams] = useSearchParams();
  const message = searchParams.get("message");
  const event = searchParams.get("event");
  // Explicit `follow=1` arms the transcript's live-tail at mount (a shareable
  // "following the live sample" URL), overriding the deep-link stand-down.
  const follow = searchParams.get("follow") === "1";
  return {
    message,
    event,
    follow,
  };
};

/**
 * Hook for navigating to sample details from the samples grid.
 * Uses the /samples route pattern instead of /logs.
 *
 * Used to obtain an action function only — no data, no mount side effects.
 */
export const useSamplesGridNavigationAction = () => {
  const navigate = useNavigate();
  const logDirectory = useLogDir();

  const getSampleDetailUrl = useCallback(
    (logFile: string, sampleId: string | number, epoch: number) => {
      // Convert absolute logFile path to relative path
      const relativePath = directoryRelativeUrl(logFile, logDirectory);
      return samplesSampleUrl(relativePath, sampleId, epoch);
    },
    [logDirectory]
  );

  const navigateToSampleDetail = useCallback(
    (logFile: string, sampleId: string | number, epoch: number) => {
      navigateAndForget(navigate, getSampleDetailUrl(logFile, sampleId, epoch));
    },
    [navigate, getSampleDetailUrl]
  );

  return {
    getSampleDetailUrl,
    navigateToSampleDetail,
  };
};

/**
 * Hook for sample navigation within the log context (LogSampleDetailView).
 * Uses filteredSamples to navigate between samples respecting current filters.
 *
 * Used to obtain action functions (plus their enablement flags) —
 * no mount side effects.
 */
export const useLogSampleNavigationActions = () => {
  const navigate = useNavigate();
  const prefix = useRoutePrefix();
  const location = useLocation();
  // Keep prev/next on the originating surface (the focus page is also mounted
  // under /samples); logSamplesUrl would otherwise force a /logs URL.
  const isSamplesSurface = location.pathname.startsWith("/samples/");
  const { logPath, sampleTabId } = useLogOrSampleRouteParams();

  // Get filtered samples for navigation
  const sampleSummaries = useFilteredSamples();

  // Get the currently selected sample
  const sampleHandle = useCurrentSampleHandle();

  // Calculate current index in the filtered samples list
  const currentIndex = useMemo(() => {
    if (!sampleHandle) {
      return -1;
    }
    return sampleSummaries.findIndex((summary) => {
      return (
        sampleIdsEqual(summary.id, sampleHandle.id) &&
        summary.epoch === sampleHandle.epoch
      );
    });
  }, [sampleHandle, sampleSummaries]);

  // Navigation state
  const hasPrevious = currentIndex > 0;
  const hasNext =
    currentIndex >= 0 && currentIndex < sampleSummaries.length - 1;

  // The sibling samples' routes, shared by the click handlers and the
  // chevrons' hrefs so a plain click and a new-tab open land in one place.
  const siblingRoute = (sample: SampleSummary | undefined) => {
    if (!sample || !logPath) return undefined;
    return isSamplesSurface
      ? samplesSampleUrl(logPath, sample.id, sample.epoch, sampleTabId)
      : logSamplesUrl(logPath, sample.id, sample.epoch, sampleTabId, prefix);
  };
  const prevSample = hasPrevious
    ? sampleSummaries[currentIndex - 1]
    : undefined;
  const nextSample = hasNext ? sampleSummaries[currentIndex + 1] : undefined;
  const previousRoute = siblingRoute(prevSample);
  const nextRoute = siblingRoute(nextSample);

  // Navigate to previous sample
  const onPrevious = useCallback(() => {
    if (previousRoute) navigateAndForget(navigate, previousRoute);
  }, [previousRoute, navigate]);

  // Navigate to next sample
  const onNext = useCallback(() => {
    if (nextRoute) navigateAndForget(navigate, nextRoute);
  }, [nextRoute, navigate]);

  return {
    onPrevious,
    onNext,
    hasPrevious,
    hasNext,
    previousHref: toFullUrlMaybe(previousRoute),
    nextHref: toFullUrlMaybe(nextRoute),
  };
};
