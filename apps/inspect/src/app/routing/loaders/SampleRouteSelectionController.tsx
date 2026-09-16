import { FC } from "react";

import { useSamplesRouteParams } from "../url";
import { useRouteSelectionMirror } from "../useRouteSelectionMirror";

/**
 * Syncs the samples route's log file + sample into the selection; the
 * selection drives the details query (no listing entry or prior sync is
 * required to open a log). Route→selection stays an imperative UI-state
 * mutation until selection derives from the route (future routing rework).
 * Returns null.
 */
export const SampleRouteSelectionController: FC = () => {
  const { samplesPath: logPath, sampleId, epoch } = useSamplesRouteParams();
  useRouteSelectionMirror({ logPath, sampleId, epoch });
  return null;
};
