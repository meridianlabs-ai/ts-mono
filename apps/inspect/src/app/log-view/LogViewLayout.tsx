import clsx from "clsx";
import { FC, useCallback, useRef } from "react";

import {
  ErrorPanel,
  FindBand,
  FindTargetProvider,
  LoadingBar,
  useFindBandShortcut,
} from "@tsmono/react/components";
import { FindProvider } from "@tsmono/react/find";

import { useAppConfig } from "../../app_config";
import { useSelectedLogDetail } from "../../state/selectedLogDetails";
import { useStore } from "../../state/store";
import { ApplicationNavbar } from "../navbar/ApplicationNavbar";
import { logsUrl, useLogRouteParams, useRoutePrefix } from "../routing/url";

import { LogView } from "./LogView";

/**
 * AppContent component with the main UI layout
 */
export const LogViewLayout: FC = () => {
  // Loading/error for the open log derive from the selected log's details.
  const { loading: logLoading, error: logError } = useSelectedLogDetail();

  // Find
  const showFind = useStore((state) => state.app.showFind);
  const setShowFind = useStore((state) => state.appActions.setShowFind);
  const nativeFind = useStore((state) => state.app.nativeFind);
  const hideFind = useStore((state) => state.appActions.hideFind);

  const { singleFileMode } = useAppConfig();

  // Route params
  const { logPath } = useLogRouteParams();
  const prefix = useRoutePrefix();
  const navigationUrl = (file: string, log_dir?: string) =>
    logsUrl(file, log_dir, undefined, prefix);

  // The main application reference
  const mainAppRef = useRef<HTMLDivElement>(null);

  const openFind = useCallback(() => setShowFind(true), [setShowFind]);
  useFindBandShortcut(openFind, {
    onClose: hideFind,
    isOpen: showFind,
    enabled: !nativeFind,
  });

  return (
    <FindProvider>
      <FindTargetProvider>
        <div
          ref={mainAppRef}
          className={clsx(
            "app-main-grid",
            singleFileMode ? "single-file-mode" : undefined,
            "log-view"
          )}
          // The VS Code webview focuses the nearest container tabstop when a
          // non-interactive spot is clicked, and App.css suppresses the focus
          // ring this one would otherwise show. Keep it until that interaction
          // is retested in the extension.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          {showFind ? <FindBand onClose={hideFind} /> : ""}
          {!singleFileMode ? (
            <ApplicationNavbar
              fnNavigationUrl={navigationUrl}
              currentPath={logPath}
            />
          ) : (
            <LoadingBar loading={logLoading} />
          )}
          {logError ? (
            <ErrorPanel
              title="An error occurred while loading this task."
              error={logError}
            />
          ) : (
            <LogView />
          )}
        </div>
      </FindTargetProvider>
    </FindProvider>
  );
};
