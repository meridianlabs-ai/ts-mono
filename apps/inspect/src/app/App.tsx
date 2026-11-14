import "@tsmono/theme/tokens";
import "@tsmono/theme/reset";
import "@tsmono/theme/components";
import "@tsmono/theme/utilities";
import "prismjs/themes/prism.css";
import "@tsmono/theme/base";
import "@tsmono/theme/vscode";
import "./App.css";

import { TanStackDevtools } from "@tanstack/react-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { FC, useCallback, useState } from "react";
import { RouterProvider } from "react-router/dom";

import { useEventListener } from "@tsmono/react/hooks";
import { getVscodeApi } from "@tsmono/util";
import { ZustandDevtoolsPanel } from "@tsmono/zustand-devtools";

import {
  AppConfigGate,
  LogLocationGate,
  readEmbeddedStartupState,
  resolveEmbeddedLogDir,
  setLogRoot,
} from "../app_config";
import { HostMessage } from "../client/api/types.ts";
import { webviewStorage } from "../client/storage";
import { FetchEngineController, imperativeLogData } from "../log_data";
import { queryClient } from "../state/queryClient.ts";
import { storeImplementation } from "../state/store.ts";
import {
  SETTINGS_STORAGE_KEY,
  useUserSettings,
} from "../state/userSettings.ts";

import { AppProviders } from "./AppProviders.tsx";
import { getAppRouter } from "./routing/AppRouter.tsx";
import {
  createHostCommandFilter,
  hostDestinationRoute,
} from "./routing/hostNavigation";

/**
 * Keep the applied theme in lockstep with other tabs' preference writes. The
 * inline bootstrap sets the theme before first paint from localStorage, and
 * setThemePreference re-applies on in-tab picks; this pulls cross-tab writes
 * back into zustand (persist doesn't listen for `storage` events itself).
 *
 * A render-null controller at the composition root.
 */
const ThemePreferenceSyncController: FC = () => {
  useEventListener(window, "storage", (e) => {
    if (e.key === SETTINGS_STORAGE_KEY) {
      // Re-apply CSS for this tab (the bootstrap reads the freshly-written
      // value) and pull the new preference into the store.
      window.__APPLY_BROWSER_THEME__?.();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- rehydrate never rejects: zustand routes its errors to onRehydrateStorage, and its anonymous type can't be listed in allowForKnownSafeCalls
      useUserSettings.persist.rehydrate();
    }
  });

  return null;
};

/**
 * Renders the application content. Mounted below the config gate so it can
 * read the resolved app config.
 */
export const AppContent: FC = () => {
  const [router] = useState(getAppRouter);
  const [isNewHostCommand] = useState(() =>
    createHostCommandFilter(webviewStorage, readEmbeddedStartupState())
  );

  const onMessage = useCallback(
    (e: HostMessage) => {
      switch (e.data.type) {
        case "updateState": {
          if (e.data.url && isNewHostCommand(e.data)) {
            const decodedUrl = decodeURIComponent(e.data.url);

            // Update the resolved log dir for host-driven (live) navigation —
            // the one place logDir changes after the gate. The initial embedded
            // dir is already seeded by the log-root resolution at startup.
            setLogRoot(resolveEmbeddedLogDir(decodedUrl));

            router.navigate(hostDestinationRoute(e.data), { replace: true });
          }
          break;
        }
        case "backgroundUpdate": {
          imperativeLogData.invalidateLogListing();
          break;
        }
      }
    },
    [router, isNewHostCommand]
  );

  // Only the VS Code host may drive the log location. A window message can't
  // be authenticated (any page embedding the viewer can post one), so outside
  // VS Code the bridge is never attached (#615).
  useEventListener(getVscodeApi() ? window : null, "message", onMessage);

  return (
    <>
      <ThemePreferenceSyncController />
      <FetchEngineController />
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </>
  );
};

/**
 * Renders the Main Application. Owns the query client provider so the
 * exported <App> stays self-contained for external embedders.
 */
// Reads the live `storeImplementation` binding at render time: the store
// doesn't exist until app initialization, which can be after devtools mount.
const ZustandStorePanel: FC<{ theme: "light" | "dark" }> = ({ theme }) =>
  storeImplementation ? (
    <ZustandDevtoolsPanel store={storeImplementation} theme={theme} />
  ) : (
    <div>Store not initialized</div>
  );

export const App: FC = () => (
  <QueryClientProvider client={queryClient}>
    <LogLocationGate>
      <AppConfigGate>
        <AppContent />
      </AppConfigGate>
    </LogLocationGate>
    {/* navigator.webdriver: skip devtools under Playwright — the floating
        button is an extra img/button that trips strict-mode locators. */}
    {import.meta.env.DEV && !navigator.webdriver && (
      <TanStackDevtools
        plugins={[
          { name: "TanStack Query", render: <ReactQueryDevtoolsPanel /> },
          {
            name: "Zustand Inspector",
            render: (_el, props) => <ZustandStorePanel theme={props.theme} />,
          },
        ]}
      />
    )}
  </QueryClientProvider>
);
