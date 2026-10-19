// Bundle the app-level CSS the embedded library needs into the lib build. The
// standalone app imports these in main.tsx, which the lib build does NOT
// include — so without them, embedded scout (e.g. in hawk) lost the Bootstrap
// `--bs-*` design tokens its panels rely on (which made light mode render dark panels).
// Mirrors apps/inspect/App.tsx. Imported before @tsmono/theme below so the
// theme overrides Bootstrap's defaults.
import "bootstrap/dist/css/bootstrap.min.css";

import { createContext, FC, useLayoutEffect, useMemo } from "react";
import { RouterProvider } from "react-router/dom";

import "prismjs/themes/prism.css";
import "@tsmono/theme/base";
import "@tsmono/theme/vscode";
import "./app/App.css";

import { trustContentSetting } from "@tsmono/inspect-components/content";
import {
  AppErrorBoundary,
  ContentTrustCeilingProvider,
  ExtendedFindProvider,
  FindTargetProvider,
} from "@tsmono/react/components";
import { useEventListener } from "@tsmono/react/hooks";
import { ComponentStateProvider } from "@tsmono/react/state";

import { useAppConfigAsync } from "./app/server/useAppConfig";
import { useTopicInvalidation } from "./app/server/useTopicInvalidation";
import { createAppRouter } from "./AppRouter";
import { scoutStateHooks } from "./state/componentStateAdapter";
import { SETTINGS_STORAGE_KEY, useUserSettings } from "./state/userSettings";

export const AppModeContext = createContext<AppProps["mode"]>("scans");

export interface AppProps {
  mode?: "scans" | "workbench";
}

export const App: FC<AppProps> = (props) => {
  const invalidationReady = useTopicInvalidation();
  useThemePreferenceSync();

  return invalidationReady ? <AppContent {...props} /> : null;
};

const useThemePreferenceSync = () => {
  const themePreference = useUserSettings((s) => s.themePreference);
  // useLayoutEffect (not useEffect): apply before the browser paints so an
  // in-tab pick flips the CSS in the same frame the toggle re-renders.
  // A post-paint effect updates the icon a frame before the colors, flashing
  // the old theme.
  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useLayoutEffect(() => {
    window.__APPLY_BROWSER_THEME__?.();
  }, [themePreference]);

  // Cross-tab: zustand persist doesn't subscribe to `storage` events, so
  // another tab's write would leave this tab stale. Re-apply CSS (the bootstrap
  // reads the freshly-written value) and pull the new preference into zustand.
  useEventListener(window, "storage", (e) => {
    if (e.key === SETTINGS_STORAGE_KEY) {
      window.__APPLY_BROWSER_THEME__?.();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      useUserSettings.persist.rehydrate();
    }
  });
};

const AppContent: FC<AppProps> = ({ mode = "scans" }) => {
  const router = useAppRouter(mode);
  const trustCeiling = trustContentSetting(
    useAppConfigAsync().data?.trust_content
  );

  return router ? (
    <AppErrorBoundary>
      <ComponentStateProvider hooks={scoutStateHooks}>
        <AppModeContext.Provider value={mode}>
          <ExtendedFindProvider>
            <FindTargetProvider>
              {/* Content is untrusted unless a nearer provider says otherwise
                    (a transcript's own trust, or app-owned data); the key
                    remounts everything when the ceiling changes. */}
              <ContentTrustCeilingProvider value={trustCeiling}>
                <RouterProvider key={trustCeiling} router={router} />
              </ContentTrustCeilingProvider>
            </FindTargetProvider>
          </ExtendedFindProvider>
        </AppModeContext.Provider>
      </ComponentStateProvider>
    </AppErrorBoundary>
  ) : null;
};

const useAppRouter = (mode: "scans" | "workbench") => {
  const { data: appConfig } = useAppConfigAsync();
  return useMemo(
    () => (appConfig ? createAppRouter({ mode, config: appConfig }) : null),
    [mode, appConfig]
  );
};
