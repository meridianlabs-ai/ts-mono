import { QueryClientProvider } from "@tanstack/react-query";
import { FC, ReactNode } from "react";

import { AppConfigGate, useAppConfigAsync } from "./app_config";
import { FetchEngineController } from "./log_data";
import { queryClient } from "./state/queryClient";

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
 * Boots the query client, resolved app config, and fetch engine required by
 * `useEvalSampleData` and the other log-data hooks outside `<App/>`.
 * Install the API factory and initialize the viewer store before rendering
 * one provider at the host application's viewer boundary.
 */
export const InspectDataProvider: FC<{ children: ReactNode }> = ({
  children,
}) => (
  <InspectQueryClientProvider>
    <AppConfigGate>
      <FetchEngineController />
      {children}
    </AppConfigGate>
  </InspectQueryClientProvider>
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
