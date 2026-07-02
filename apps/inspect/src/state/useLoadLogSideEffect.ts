import { useEffect } from "react";

import { useSamplesRouteParams } from "../app/routing/url";

import { selectLogFile } from "./actions";
import { useStore } from "./store";

/**
 * Select the route's log file and sample; the selection drives the details
 * query (no listing entry or prior sync is required to open a log).
 *
 * Used to trigger side effects only — returns nothing.
 */
export const useLoadLogSideEffect = () => {
  const {
    samplesPath: routeLogPath,
    sampleId,
    epoch,
  } = useSamplesRouteParams();
  const selectSample = useStore((state) => state.logActions.selectSample);
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);

  useEffect(() => {
    if (routeLogPath && sampleId && epoch) {
      if (selectedLogFile !== routeLogPath) {
        selectLogFile(routeLogPath);
      }
      selectSample(sampleId, parseInt(epoch, 10), routeLogPath);
    }
  }, [routeLogPath, sampleId, epoch, selectSample, selectedLogFile]);
};
