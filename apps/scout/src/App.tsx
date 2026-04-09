import { createContext, FC, useMemo } from "react";
import { RouterProvider } from "react-router-dom";

import "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/themes/prism.css";
import "./app/App.css";

import {
  ComponentIconProvider,
  ComponentIcons,
  ExtendedFindProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";

import { useAppConfigAsync } from "./app/server/useAppConfig";
import { useTopicInvalidation } from "./app/server/useTopicInvalidation";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { createAppRouter } from "./AppRouter";
import { ApplicationIcons } from "./icons";
import { scoutStateHooks } from "./state/componentStateAdapter";

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

  return invalidationReady ? <AppContent {...props} /> : null;
};

const AppContent: FC<AppProps> = ({ mode = "scans" }) => {
  const router = useAppRouter(mode);

  return router ? (
    <AppErrorBoundary>
      <ComponentIconProvider icons={componentIcons}>
        <ComponentStateProvider hooks={scoutStateHooks}>
          <AppModeContext.Provider value={mode}>
            <ExtendedFindProvider>
              <RouterProvider router={router} />
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
