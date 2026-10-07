import { QueryClientProvider } from "@tanstack/react-query";
import { FC, ReactNode, useSyncExternalStore } from "react";

import { useAppConfigAsync, useLogDir } from "./app_config";
import { getAppRouter } from "./app/routing/AppRouter";
import { useRouteSelection } from "./app/routing/currentSelection";
import { sampleIdsEqual } from "./app/shared/sample";
import { useLogHeader } from "./log_data";
import { queryClient } from "./state/queryClient";
import { getAvailableScorers } from "./state/scoring";
import { useStore } from "./state/store";

/**
 * Supplies the viewer's react-query client to a subtree.
 *
 * Standalone `inspect view` gets this from `<App/>` internally. External
 * embedders that call the viewer's selection hooks (`useSelectedSampleSummary`,
 * `useSelectedScores`, `useLogSelection`) from their OWN chrome — rendered as a
 * sibling of `<App/>`, not a descendant — must wrap that chrome in this provider
 * so those hooks resolve the same react-query client the viewer uses internally
 * (the data-flow refactor in #389 moved config/sample loading onto react-query).
 * Without it the hooks throw "No QueryClient set". Safe to nest: `<App/>`
 * provides the same client again for its own subtree.
 */
export const InspectQueryClientProvider: FC<{ children: ReactNode }> = ({
  children,
}) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/**
 * Whether the viewer's app config has resolved. `<App/>` gates its own content
 * on this via `<AppConfigGate>`, but the viewer's data hooks (`useLogDir`,
 * `useSelectedSampleSummary`, ...) THROW ("App config not loaded") if called
 * before it resolves. Embedders calling those hooks in their own chrome must
 * hold off until this returns true. Must be called within an
 * `<InspectQueryClientProvider>`.
 */
export const useViewerReady = (): boolean =>
  useAppConfigAsync().data !== undefined;

// External chrome is outside RouterProvider. Subscribe to the actual router
// rather than publishing another writable navigation snapshot for embedders.
const subscribeToRoute = (notify: () => void) =>
  getAppRouter().subscribe(notify);
const currentLocation = () => getAppRouter().state.location;

function useEmbeddedRouteSelection() {
  const location = useSyncExternalStore(subscribeToRoute, currentLocation);
  return useRouteSelection(location.pathname);
}

function useEmbeddedSelection() {
  const selection = useEmbeddedRouteSelection();
  const highlighted = useStore((state) => state.log.highlightedSample);
  // On a log's sample list, embedders may preview the highlighted row without
  // opening detail. A remembered row from a different log cannot take over.
  const handle =
    selection.sample ??
    (!selection.hasExplicitSample && highlighted?.logFile === selection.logFile
      ? highlighted
      : undefined);
  const sample = selection.summaries.find(
    (summary) =>
      sampleIdsEqual(summary.id, handle?.id) && summary.epoch === handle?.epoch
  );
  return { logFile: selection.logFile, sample };
}

export function useSelectedSampleSummary() {
  return useEmbeddedSelection().sample;
}

export function useLogSelection() {
  const selection = useEmbeddedSelection();
  const detail = useLogHeader(useLogDir(), selection.logFile, {
    demand: "passive",
  });
  return {
    ...selection,
    loadedLog: detail.data ? selection.logFile : undefined,
  };
}

export function useSelectedScores() {
  const selection = useEmbeddedRouteSelection();
  const detail = useLogHeader(useLogDir(), selection.logFile, {
    demand: "passive",
  });
  const selected = useStore((state) => state.log.selectedScores);
  return (
    selected ??
    (detail.data
      ? (getAvailableScorers(detail.data, selection.summaries) ?? [])
      : [])
  );
}
