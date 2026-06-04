// Bundle the app-level CSS the embedded library needs into the lib build. The
// standalone app imports these in main.tsx, which the lib build does NOT
// include — so without them, embedded scout (e.g. in hawk) lost its icon
// glyphs (Bootstrap Icons) and, more subtly, the Bootstrap design tokens its
// panels rely on (which made light mode render dark panels).
// Mirrors apps/inspect/App.tsx. Imported before @tsmono/theme below so the
// theme overrides Bootstrap's defaults.
import "bootstrap-icons/font/bootstrap-icons.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "@vscode/codicons/dist/codicon.css";

import { createContext, FC, useEffect, useLayoutEffect, useMemo } from "react";
import { RouterProvider } from "react-router-dom";

import "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/themes/prism.css";
import "@tsmono/theme/base";
import "@tsmono/theme/bootstrap-compat";
import "@tsmono/theme/vscode";
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
  // useLayoutEffect (not useEffect): apply before the browser paints so an
  // in-tab pick flips the CSS in the same frame the toggle re-renders.
  // A post-paint effect updates the icon a frame before the colors, flashing
  // the old theme.
  useLayoutEffect(() => {
    window.__APPLY_BROWSER_THEME__?.();
  }, [themePreference]);

  // Cross-tab: zustand persist doesn't subscribe to `storage` events, so
  // another tab's write would leave this tab stale. Re-apply CSS (the bootstrap
  // reads the freshly-written value) and pull the new preference into zustand.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY) {
        window.__APPLY_BROWSER_THEME__?.();
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
