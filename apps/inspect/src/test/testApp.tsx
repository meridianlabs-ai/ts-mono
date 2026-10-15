import { QueryClientProvider } from "@tanstack/react-query";
import Dexie from "dexie";
import { FC, ReactNode } from "react";
import { MemoryRouter } from "react-router";

import {
  ComponentIconProvider,
  ExtendedFindProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { testIcons } from "@tsmono/react/testing";

import { APP_CONFIG_KEY, initAppConfig, type AppConfig } from "../app_config";
import { CurrentSelectionProvider } from "../app/routing/currentSelection";
import { testClientAPI } from "../client/api/testClientApi";
import { DB_NAME } from "../client/database";
import { FetchEngineController } from "../log_data";
import { releaseDatabase } from "../log_data/databaseInstance";
import { inspectStateHooks } from "../state/componentStateAdapter";
import { queryClient } from "../state/queryClient";
import { initializeStore } from "../state/store";

/**
 * Resolve the viewer's state the way `main.tsx` and `<AppConfigGate>` do,
 * without rendering the app: initialize the store, and resolve the config
 * (the module singleton plus the react-query entry `useAppConfig` and
 * `useLogDir` read) over `config.api`. Defaults to single-file mode, whose
 * fetch engine opens no IndexedDB (writes are cache-only).
 */
export const startTestApp = (overrides: Partial<AppConfig> = {}): AppConfig => {
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
  const singleFileMode = overrides.singleFileMode ?? true;
  const config = initAppConfig({
    api: testClientAPI(),
    loader: singleFileMode ? "direct" : "replicator",
    inspect_version: "test",
    scout_version: null,
    logDir: "/logs",
    ...overrides,
    singleFileMode,
  });
  queryClient.setQueryData(APP_CONFIG_KEY, config);
  return config;
};

/** Drop everything the viewer cached or stored: the query cache, the
 *  shared database handle, and the database. Unmount first (`cleanup()`):
 *  that stops the fetch engine. */
export const stopTestApp = async (): Promise<void> => {
  queryClient.clear();
  releaseDatabase();
  await Dexie.delete(DB_NAME);
};

/**
 * What the app renders below the config gate, for a subtree under test: the
 * query client, the fetch engine, and — given a `path` — a router at that
 * path with the route-derived selection.
 */
export const TestApp: FC<{ path?: string; children: ReactNode }> = ({
  path,
  children,
}) => (
  <QueryClientProvider client={queryClient}>
    <FetchEngineController />
    {path === undefined ? (
      children
    ) : (
      <MemoryRouter initialEntries={[path]}>
        <CurrentSelectionProvider>{children}</CurrentSelectionProvider>
      </MemoryRouter>
    )}
  </QueryClientProvider>
);

/** A `renderHook` wrapper rendering below `<TestApp path={path}>`. */
export const atRoute = (path?: string): FC<{ children: ReactNode }> => {
  const AtRoute: FC<{ children: ReactNode }> = ({ children }) => (
    <TestApp path={path}>{children}</TestApp>
  );
  return AtRoute;
};

/**
 * The component-level context views render under in the app: icons and
 * component state backed by the store (from `AppContent`; needs
 * `startTestApp`), and transcript search (from `LogViewLayout`).
 */
export const ComponentProviders: FC<{ children: ReactNode }> = ({
  children,
}) => (
  <ComponentIconProvider icons={testIcons}>
    <ComponentStateProvider hooks={inspectStateHooks}>
      <ExtendedFindProvider>{children}</ExtendedFindProvider>
    </ComponentStateProvider>
  </ComponentIconProvider>
);
