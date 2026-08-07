import clsx from "clsx";
import { FC, useCallback, useEffect, useRef } from "react";

import { ErrorPanel } from "@tsmono/react/components";
import { FindBar, FindProvider, useFindBandShortcut } from "@tsmono/react/find";

import { useAppConfig } from "../../app_config";
import { ActivityBar } from "../../components/ActivityBar";
import { kLogViewSamplesTabId } from "../../constants";
import { useTotalSampleCount } from "../../state/hooks";
import { useSelectedLogDetail } from "../../state/selectedLogDetails";
import { useStore } from "../../state/store";
import { ApplicationNavbar } from "../navbar/ApplicationNavbar";
import { logsUrl, useLogRouteParams, useRoutePrefix } from "../routing/url";

import { LogView } from "./LogView";

// Tabs whose pane is a virtualized data grid. A find band over a grid
// implies find-across-all-rows, but only mounted rows are searchable — so
// Ctrl+F passes through to the browser's native find and the grid's own
// filters cover the rest.
const kGridWorkspaceTabIds: string[] = [kLogViewSamplesTabId];

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

  // The samples tab hosts the grid only for multi-sample logs; a single
  // sample renders inline (fully mounted) and keeps the band.
  const workspaceTab = useStore((state) => state.app.tabs.workspace);
  const totalSampleCount = useTotalSampleCount();
  const gridTabActive =
    kGridWorkspaceTabIds.includes(workspaceTab) && totalSampleCount > 1;

  const openFind = useCallback(() => setShowFind(true), [setShowFind]);
  useFindBandShortcut(openFind, {
    onClose: hideFind,
    isOpen: showFind,
    enabled: !nativeFind && !gridTabActive,
  });

  // A band opened on another tab would linger inert over the grid.
  useEffect(() => {
    if (gridTabActive && showFind) {
      hideFind();
    }
  }, [gridTabActive, showFind, hideFind]);

  return (
    <FindProvider>
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
        {showFind ? <FindBar onClose={hideFind} /> : ""}
        {!singleFileMode ? (
          <ApplicationNavbar
            fnNavigationUrl={navigationUrl}
            currentPath={logPath}
          />
        ) : (
          <ActivityBar animating={logLoading} />
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
    </FindProvider>
  );
};
