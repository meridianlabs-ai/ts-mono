import "bootstrap-icons/font/bootstrap-icons.css";
import "bootstrap/dist/css/bootstrap.css";

import JSON5 from "json5";

import "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/themes/prism.css";
import "@tsmono/theme/base";
import "@tsmono/theme/vscode";
import "./App.css";

import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import ClipboardJS from "clipboard";
import { FC, useCallback, useEffect, useLayoutEffect } from "react";
import { RouterProvider } from "react-router-dom";

import {
  ComponentIconProvider,
  ComponentIcons,
  PulsingDots,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { basename, dirname } from "@tsmono/util";

import { ClientAPI, HostMessage } from "../client/api/types.ts";
import { inspectStateHooks } from "../state/componentStateAdapter";
import { queryClient } from "../state/queryClient.ts";
import { ApiProvider, useApi, useStore } from "../state/store.ts";
import { logListingQueryKey, useLogListing } from "../state/useLogListing.ts";
import {
  SETTINGS_STORAGE_KEY,
  useUserSettings,
} from "../state/userSettings.ts";
import { isUri } from "../utils/uri.ts";

import { ApplicationIcons } from "./appearance/icons.ts";
import { AppRouter } from "./routing/AppRouter.tsx";
import { useAppConfigAsync } from "./server/useAppConfig.ts";

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

export interface AppProps {
  api: ClientAPI;
}

// Keep the applied theme in lockstep with the persisted preference. The inline
// bootstrap sets the theme before first paint from localStorage; here we
// re-apply whenever the in-app picker changes it, and pull cross-tab writes
// back into zustand (persist doesn't listen for `storage` events itself).
const useThemePreferenceSync = () => {
  const themePreference = useUserSettings((s) => s.themePreference);
  // useLayoutEffect (not useEffect): apply before the browser paints so an
  // in-tab pick flips the CSS in the same frame the toggle re-renders. With a
  // post-paint effect the icon updates a frame before the colors, flashing the
  // old theme. (The old bespoke hook applied synchronously on write.)
  useLayoutEffect(() => {
    window.__APPLY_BROWSER_THEME__?.();
  }, [themePreference]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY) {
        // Re-apply CSS for this tab (the bootstrap reads the freshly-written
        // value) and pull the new preference into the store.
        window.__APPLY_BROWSER_THEME__?.();
        void useUserSettings.persist.rehydrate();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
};

/**
 * Renders the application content. Mounted below the providers in App so it
 * can read the api context.
 */
const AppContent: FC = () => {
  useThemePreferenceSync();

  const api = useApi();

  // Whether the app was rehydrated
  const rehydrated = useStore((state) => state.app.rehydrated);

  const logDir = useStore((state) => state.logs.logDir);
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const loadedLogFile = useStore((state) => state.log.loadedLog);
  const selectedLogDetails = useStore((state) => state.log.selectedLogDetails);

  const setInitialState = useStore((state) => state.appActions.setInitialState);
  const setLoading = useStore((state) => state.appActions.setLoading);

  const ensureReplicationReady = useStore(
    (state) => state.logsActions.ensureReplicationReady
  );
  const queryClient = useQueryClient();
  const initLogDir = useStore((state) => state.logsActions.initLogDir);
  const setLogDir = useStore((state) => state.logsActions.setLogDir);
  const setLogFiles = useStore((state) => state.logsActions.setLogHandles);
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );

  const loadLog = useStore((state) => state.logActions.syncLog);
  const pollLog = useStore((state) => state.logActions.pollLog);

  useLogListing(logDir);

  useEffect(() => {
    void ensureReplicationReady();
  }, [ensureReplicationReady]);

  // Load a specific log
  useEffect(() => {
    const loadSpecificLog = async () => {
      // Ignore if there is no log file.
      if (!selectedLogFile) {
        return;
      }

      if (selectedLogFile === loadedLogFile && selectedLogDetails) {
        // The log is already loaded and we have the data
        return;
      }

      try {
        // Set loading first and wait for it to update
        setLoading(true);

        // Then load the log
        await loadLog(selectedLogFile);

        // Finally set loading to false
        setLoading(false);
      } catch (e) {
        console.log(e);
        setLoading(false, e as Error);
      }
    };

    loadSpecificLog();
  }, [selectedLogFile, loadedLogFile, selectedLogDetails, loadLog, setLoading]);

  useEffect(() => {
    // If the component re-mounts and there is a running load loaded
    // start up polling
    const doPoll = async () => {
      await pollLog();
    };
    if (selectedLogDetails?.status === "started") {
      doPoll();
    }
  }, [pollLog, selectedLogDetails?.status]);

  const onMessage = useCallback(
    async (e: HostMessage) => {
      switch (e.data.type) {
        case "updateState": {
          if (e.data.url) {
            const decodedUrl = decodeURIComponent(e.data.url);

            let targetFile = decodedUrl;
            if (isUri(targetFile)) {
              // If it's a URI, just set the log file directly
              const dir = dirname(targetFile);
              targetFile = basename(targetFile);
              setLogDir(dir);
            }

            if (!rehydrated) {
              setInitialState(
                targetFile,
                e.data.sample_id,
                e.data.sample_epoch
              );
            }
          }
          break;
        }
        case "backgroundUpdate": {
          const decodedUrl = decodeURIComponent(e.data.url);
          const log_dir = e.data.log_dir;
          const isFocused = document.hasFocus();
          if (!isFocused) {
            if (log_dir === logDir) {
              setSelectedLogFile(decodedUrl);
            } else {
              api.open_log_file(e.data.url, e.data.log_dir);
            }
          } else {
            queryClient.invalidateQueries({
              queryKey: logListingQueryKey(logDir),
            });
          }
          break;
        }
      }
    },
    [
      setInitialState,
      setLogDir,
      logDir,
      setSelectedLogFile,
      api,
      queryClient,
      rehydrated,
    ]
  );

  // listen for updateState messages from vscode
  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [onMessage]);

  useEffect(() => {
    const loadLogsAndState = async () => {
      // First see if there is embedded state and if so, use that
      const embeddedState = document.getElementById("logview-state");
      if (embeddedState) {
        const state = JSON5.parse(embeddedState.textContent || "");
        onMessage({ data: state });
      } else {
        // For non-route URL params support (legacy)
        const urlParams = new URLSearchParams(window.location.search);

        // If the URL provides a task file, load that
        const logPath = urlParams.get("task_file");

        // Replace spaces with a '+' sign:
        const resolvedLogPath = logPath ? logPath.replace(" ", "+") : logPath;

        if (resolvedLogPath) {
          // Clear any log dir
          setLogDir(undefined);
          // Load just the passed file
          setLogFiles([{ name: resolvedLogPath }]);
        } else {
          // If a log file was passed, select it
          const log_file = urlParams.get("log_file");
          if (log_file) {
            await initLogDir();
            setSelectedLogFile(log_file);
          }
          // Else do nothing - RouteProvider will handle it
        }
      }

      new ClipboardJS(".clipboard-button,.copy-button");
    };

    loadLogsAndState();
  }, [setLogDir, setLogFiles, setSelectedLogFile, initLogDir, onMessage]);

  return (
    <ComponentIconProvider icons={componentIcons}>
      <ComponentStateProvider hooks={inspectStateHooks}>
        <RouterProvider router={AppRouter} />
      </ComponentStateProvider>
    </ComponentIconProvider>
  );
};

const AppConfigGate: FC = () => {
  const appConfig = useAppConfigAsync();

  if (appConfig.error) {
    return (
      <div className="app-config-gate">
        Failed to load application configuration: {appConfig.error.message}
      </div>
    );
  }
  if (!appConfig.data) {
    return (
      <div className="app-config-gate">
        <PulsingDots size="large" text="Loading application…" />
      </div>
    );
  }

  return <AppContent />;
};

/**
 * Renders the Main Application. Owns the query client + api providers so the
 * exported <App> stays self-contained for external embedders.
 */
export const App: FC<AppProps> = ({ api }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <AppConfigGate />
      </ApiProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
};
