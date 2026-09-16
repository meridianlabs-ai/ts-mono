import { useMirrorToStore } from "@tsmono/react/hooks";

import { selectLogFile, selectSample } from "../../state/actions";

export interface RouteSelectionParams {
  logPath?: string;
  sampleId?: string;
  epoch?: string;
}

interface RouteSelection {
  logPath: string;
  sampleId: string;
  epoch: string;
}

const routeSelection = ({
  logPath,
  sampleId,
  epoch,
}: RouteSelectionParams): RouteSelection | undefined =>
  logPath && sampleId && epoch ? { logPath, sampleId, epoch } : undefined;

const applyRouteSelection = ({ logPath, sampleId, epoch }: RouteSelection) => {
  selectLogFile(logPath);
  const targetEpoch = parseInt(epoch, 10);
  if (Number.isNaN(targetEpoch)) {
    return;
  }
  selectSample(sampleId, targetEpoch, logPath);
};

/**
 * Mirrors a sample route's log + sample into the selection store
 * (`logs.selectedLogFile`, `log.selectedSampleHandle`), which stays what the
 * data hooks key on. Writes only when all three params are present and only
 * when they change, so the store keeps the last selection once the route
 * stops naming one. A route-relative log name is absolutized by the actions.
 * The log is selected even when the epoch doesn't parse; only the sample is
 * skipped then.
 */
export const useRouteSelectionMirror = (params: RouteSelectionParams): void => {
  const selection = routeSelection(params);
  // useMirrorToStore compares by Object.is, so the mirrored value is a
  // primitive key over the three params; the writer applies the params
  // themselves (it is always the latest closure).
  const key = selection
    ? JSON.stringify([selection.logPath, selection.sampleId, selection.epoch])
    : undefined;
  useMirrorToStore(key, () => {
    if (selection) applyRouteSelection(selection);
  });
};

/**
 * The log-only form: mirrors a log route's path into `logs.selectedLogFile`
 * (absolutized), leaving the sample selection alone.
 */
export const useRouteLogSelectionMirror = (
  logPath: string | undefined
): void => {
  useMirrorToStore(logPath, selectLogFile);
};
