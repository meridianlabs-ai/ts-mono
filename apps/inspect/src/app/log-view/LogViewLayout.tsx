import clsx from "clsx";
import { FC, useEffect, useRef } from "react";

import {
  ErrorPanel,
  ExtendedFindProvider,
  FindBand,
  FindTargetProvider,
} from "@tsmono/react/components";

import { useAppConfig } from "../../app_config";
import { ActivityBar } from "../../components/ActivityBar";
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

  // Global keydown handler for keyboard shortcuts
  useEffect(() => {
    if (nativeFind) {
      return;
    }

    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault(); // Always prevent browser find
        e.stopPropagation();
        if (setShowFind) {
          setShowFind(true);
        }
      } else if (e.key === "Escape") {
        hideFind();
      }
    };

    // Use capture phase to catch event before it reaches other handlers
    document.addEventListener("keydown", handleGlobalKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [setShowFind, hideFind, nativeFind]);

  return (
    <ExtendedFindProvider>
      <FindTargetProvider>
        <div
          ref={mainAppRef}
          className={clsx(
            "app-main-grid",
            singleFileMode ? "single-file-mode" : undefined,
            "log-view"
          )}
          tabIndex={0}
        >
          {showFind ? <FindBand onClose={hideFind} /> : ""}
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
      </FindTargetProvider>
    </ExtendedFindProvider>
  );
};
