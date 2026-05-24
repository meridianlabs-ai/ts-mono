import { createContext, FC, useEffect, useMemo } from "react";
import { RouterProvider } from "react-router-dom";

import "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/themes/prism.css";
import "@tsmono/inspect-common/theme/base";
import "@tsmono/inspect-common/theme/vscode";
import "./app/App.css";

import {
  AppErrorBoundary,
  ComponentIconProvider,
  ComponentIcons,
  ExtendedFindProvider,
  FindTargetProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";

import { useAppConfigAsync } from "./app/server/useAppConfig";
import { useTopicInvalidation } from "./app/server/useTopicInvalidation";
import { createAppRouter } from "./AppRouter";
import { ApplicationIcons } from "./icons";
import { scoutStateHooks } from "./state/componentStateAdapter";
import { SETTINGS_STORAGE_KEY, useUserSettings } from "./state/userSettings";

const componentIcons: ComponentIcons = {
  chevronDown: ApplicationIcons.chevron.down,
  chevronUp: ApplicationIcons.collapse.up,
  clearText: ApplicationIcons["clear-text"],
  close: ApplicationIcons.close,
  code: ApplicationIcons.code,
  confirm: ApplicationIcons.confirm,
  copy: ApplicationIcons.copy,
  error: ApplicationIcons.error,
  menu: ApplicationIcons.threeDots,
  next: ApplicationIcons.next,
  noSamples: ApplicationIcons.noSamples,
  play: ApplicationIcons.play,
  previous: ApplicationIcons.previous,
  toggleRight: ApplicationIcons["toggle-right"],
};

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
  useEffect(() => {
    window.__APPLY_BROWSER_THEME__?.();
  }, [themePreference]);

  // Cross-tab: zustand persist doesn't subscribe to `storage` events, so
  // another tab's write would leave this tab's React state stale. The shared
  // bootstrap already re-applies CSS on its own storage listener; here we
  // only need to pull the new state into zustand.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY) {
        void useUserSettings.persist.rehydrate();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
};

const AppContent: FC<AppProps> = ({ mode = "scans" }) => {
  const router = useAppRouter(mode);

  return router ? (
    <AppErrorBoundary>
      <ComponentIconProvider icons={componentIcons}>
        <ComponentStateProvider hooks={scoutStateHooks}>
          <AppModeContext.Provider value={mode}>
            <ExtendedFindProvider>
              <FindTargetProvider>
                <RouterProvider router={router} />
              </FindTargetProvider>
            </ExtendedFindProvider>
          </AppModeContext.Provider>
        </ComponentStateProvider>
      </ComponentIconProvider>
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
