import { useEffect } from "react";

import { useStore } from "../../state/store";
import { useScanResultSummaries } from "./useScanResultSummaries";
import { useScanRoute } from "./useScanRoute";
import { useSelectedScanDataframe } from "./useSelectedScanDataframe";

/**
 * Ensure `visibleScannerResults` is populated when a scanner-result page is
 * opened directly (deep link or page reload).
 *
 * `visibleScannerResults` is normally written only by ScannerResultsList, which
 * renders under the scan-list route (ScanPanel). On a direct result URL the
 * router renders ScannerResultPanel instead, so that list never mounts and the
 * store keeps its empty default — which leaves ScannerResultNav with no items
 * to page through and hides it entirely (ScannerResultPanel gates the nav on
 * `visibleScannerResults.length > 0`).
 *
 * This seeds the store from the active scan's summaries the same way the list
 * does, but only while it's empty, so it never overrides the list view's
 * filtered/sorted set during in-app navigation.
 */
export const useEnsureVisibleScannerResults = (): void => {
  const { scanResultUuid } = useScanRoute();
  const { data: columnTable } = useSelectedScanDataframe();
  const { data: summaries } = useScanResultSummaries(columnTable);

  const isPopulated = useStore(
    (state) => state.visibleScannerResults.length > 0
  );
  const setVisibleScannerResults = useStore(
    (state) => state.setVisibleScannerResults
  );
  const setVisibleScannerResultsCount = useStore(
    (state) => state.setVisibleScannerResultsCount
  );

  useEffect(() => {
    if (isPopulated || summaries.length === 0) {
      return;
    }
    // Only seed once the loaded summaries actually contain the result we're
    // viewing. On a cold deep link `useSelectedScanDataframe` briefly resolves
    // for the DEFAULT scanner before the URL `?scanner=` param syncs into the
    // store, so summaries may belong to the wrong scanner; seeding those would
    // be locked in by the `isPopulated` guard and page through the wrong list.
    // The current result only appears in its own scanner's summaries.
    if (
      scanResultUuid &&
      !summaries.some((summary) => summary.identifier === scanResultUuid)
    ) {
      return;
    }
    setVisibleScannerResults(summaries);
    setVisibleScannerResultsCount(summaries.length);
  }, [
    isPopulated,
    scanResultUuid,
    summaries,
    setVisibleScannerResults,
    setVisibleScannerResultsCount,
  ]);
};
