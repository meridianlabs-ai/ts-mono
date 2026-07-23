import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { navigateAndForget } from "@tsmono/react/hooks";

import { useLoggingNavigate } from "../../debugging/navigationDebugging";
import { scanResultRoute } from "../../router/url";
import { useStore } from "../../state/store";
import { useScanRoute } from "../hooks/useScanRoute";
import { ScanResultSummary } from "../types";

interface ScannerResultPrevNext {
  /** The currently displayed result, if it is in the visible list. */
  result?: ScanResultSummary;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Defined only when a previous/next visible result exists. */
  onPrevious?: () => void;
  onNext?: () => void;
}

/**
 * Prev/next navigation between the scan's visible scanner results (the list
 * order of the results table). Feeds the header chevrons (ScannerResultNav),
 * which own the ArrowLeft / ArrowRight binding via `NextPreviousNav`.
 */
export const useScannerResultPrevNext = (): ScannerResultPrevNext => {
  const navigate = useLoggingNavigate("useScannerResultPrevNext");
  const [searchParams] = useSearchParams();
  const { scansDir, scanPath, scanResultUuid } = useScanRoute();

  const visibleScannerResults = useStore(
    (state) => state.visibleScannerResults
  );

  const currentIndex = useMemo(() => {
    if (!visibleScannerResults) {
      return -1;
    }
    return visibleScannerResults.findIndex(
      (s) => s.identifier === scanResultUuid
    );
  }, [visibleScannerResults, scanResultUuid]);

  const hasPrevious = currentIndex > 0;
  const hasNext =
    !!visibleScannerResults &&
    currentIndex >= 0 &&
    currentIndex < visibleScannerResults.length - 1;

  const onPrevious = useMemo(() => {
    if (!hasPrevious || !visibleScannerResults || !scansDir) {
      return undefined;
    }
    const previousResult = visibleScannerResults[currentIndex - 1];
    return () => {
      navigateAndForget(
        navigate,
        scanResultRoute(
          scansDir,
          scanPath,
          previousResult?.identifier,
          searchParams
        )
      );
    };
  }, [
    hasPrevious,
    visibleScannerResults,
    currentIndex,
    scansDir,
    scanPath,
    searchParams,
    navigate,
  ]);

  const onNext = useMemo(() => {
    if (!hasNext || !visibleScannerResults || !scansDir) {
      return undefined;
    }
    const nextResult = visibleScannerResults[currentIndex + 1];
    return () => {
      navigateAndForget(
        navigate,
        scanResultRoute(
          scansDir,
          scanPath,
          nextResult?.identifier,
          searchParams
        )
      );
    };
  }, [
    hasNext,
    visibleScannerResults,
    currentIndex,
    scansDir,
    scanPath,
    searchParams,
    navigate,
  ]);

  const result =
    visibleScannerResults && currentIndex !== -1
      ? visibleScannerResults[currentIndex]
      : undefined;

  return { result, hasPrevious, hasNext, onPrevious, onNext };
};
