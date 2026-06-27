import "bootstrap-icons/font/bootstrap-icons.css";
import "bootstrap/dist/css/bootstrap.css";
import "@vscode/codicons/dist/codicon.css";

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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import ClipboardJS from "clipboard";
import {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import { RouterProvider } from "react-router-dom";

import { defaultRetry } from "@tsmono/react";
import {
  ComponentIconProvider,
  ComponentIcons,
  PulsingDots,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { basename, dirname, getVscodeApi } from "@tsmono/util";

import { ClientAPI, HostMessage } from "../client/api/types.ts";
import { inspectStateHooks } from "../state/componentStateAdapter";
import { ApiProvider, useApi, useStore } from "../state/store.ts";
import {
  SETTINGS_STORAGE_KEY,
  useUserSettings,
} from "../state/userSettings.ts";
import { isUri } from "../utils/uri.ts";

import { ApplicationIcons } from "./appearance/icons.ts";
import { LogLocationGate } from "./LogLocationGate";
import { AppRouter } from "./routing/AppRouter.tsx";
import { useAppConfigAsync } from "./server/useAppConfig.ts";

// app-config (and future server data) flow through this client.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: defaultRetry } },
});

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

  const syncLogs = useStore((state) => state.logsActions.syncLogs);
  const initLogDir = useStore((state) => state.logsActions.initLogDir);
  const setLogDir = useStore((state) => state.logsActions.setLogDir);
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );

  const loadLog = useStore((state) => state.logActions.syncLog);
  const pollLog = useStore((state) => state.logActions.pollLog);

  // Load a specific log
  useEffect(() => {
    const loadSpecificLog = async () => {
      // Ignore if there is no log file.
      if (!selectedLogFile) {
        return;
      }
      if (
        api.log_locations?.getActiveBrowserFile() &&
        !api.log_locations.matchesActiveBrowserFile(selectedLogFile)
      ) {
        return;
      }

      try {
        // Set loading first and wait for it to update
        setLoading(true);

        // Refresh the trusted listing/scope only when rehydrated state has not
        // already been authorized by a route, host, or static grant.
        if (
          api.log_locations?.transportForFile(selectedLogFile) === "blocked"
        ) {
          const restoredLogDir = await initLogDir();
          if (
            api.log_locations.transportForFile(selectedLogFile) === "blocked"
          ) {
            const decision = api.log_locations.requestFileSelection(
              selectedLogFile,
              {
                source: "restored",
                logDir: restoredLogDir,
              }
            );
            if (decision.status !== "approved") {
              setLoading(false);
              return;
            }
          }
        }

        if (selectedLogFile === loadedLogFile && selectedLogDetails) {
          // Cached data is usable only after its location is authorized.
          setLoading(false);
          return;
        }

        // Then load the log
        await loadLog(selectedLogFile);

        // Finally set loading to false
        setLoading(false);
      } catch (e) {
        console.log(e);
        setLoading(false, e as Error);
      }
    };

    void loadSpecificLog();
  }, [
    selectedLogFile,
    loadedLogFile,
    selectedLogDetails,
    api.log_locations,
    initLogDir,
    loadLog,
    setLoading,
  ]);

  useEffect(() => {
    // If the component re-mounts and there is a running load loaded
    // start up polling
    const doPoll = async () => {
      await pollLog();
    };
    if (selectedLogDetails?.status === "started") {
      void doPoll();
    }
  }, [pollLog, selectedLogDetails?.status]);

  const applyHostMessage = useCallback(
    (data: HostMessage["data"]) => {
      switch (data.type) {
        case "updateState": {
          if (data.url) {
            const decodedUrl = decodeURIComponent(data.url);

            let targetFile = decodedUrl;
            if (isUri(targetFile)) {
              // If it's a URI, just set the log file directly
              const dir = dirname(targetFile);
              targetFile = basename(targetFile);
              setLogDir(dir);
            }

            if (!rehydrated) {
              setInitialState(targetFile, data.sample_id, data.sample_epoch);
            }
          }
          break;
        }
        case "backgroundUpdate": {
          const decodedUrl = decodeURIComponent(data.url);
          const log_dir = data.log_dir;
          const isFocused = document.hasFocus();
          if (!isFocused) {
            if (log_dir === logDir) {
              void setSelectedLogFile(decodedUrl);
            } else {
              void api.open_log_file(data.url, data.log_dir);
            }
          } else {
            void syncLogs();
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
      syncLogs,
      rehydrated,
    ]
  );

  // Runtime host messages are meaningful only inside the VS Code webview.
  useEffect(() => {
    if (!getVscodeApi()) {
      return;
    }

    const onMessage = (event: MessageEvent<unknown>) => {
      if (isHostMessageData(event.data)) {
        applyHostMessage(event.data);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [applyHostMessage]);

  useEffect(() => {
    const loadLogsAndState = async () => {
      // First see if there is embedded state and if so, use that
      const embeddedState = document.getElementById("logview-state");
      if (embeddedState && getVscodeApi()) {
        const state = JSON5.parse<unknown>(embeddedState.textContent || "");
        if (isHostMessageData(state)) {
          api.log_locations?.trustHostFile(decodeURIComponent(state.url));
          applyHostMessage(state);
        }
      } else {
        const urlParams = new URLSearchParams(window.location.search);
        const queryFile =
          urlParams.get("task_file") ?? urlParams.get("log_file");
        const approvedQueryFile =
          queryFile &&
          api.log_locations?.transportForFile(queryFile) !== "blocked"
            ? queryFile
            : undefined;
        const trustedBrowserFile = api.log_locations?.getActiveBrowserFile();

        if (approvedQueryFile) {
          if (api.log_locations) {
            await setSelectedLogFile(approvedQueryFile);
            setLogDir(undefined);
            await initLogDir();
          } else {
            setLogDir(undefined);
            await initLogDir();
            await setSelectedLogFile(approvedQueryFile);
          }
        } else if (trustedBrowserFile) {
          await setSelectedLogFile(trustedBrowserFile);
          setLogDir(undefined);
          await initLogDir();
        }
      }

      new ClipboardJS(".clipboard-button,.copy-button");
    };

    void loadLogsAndState();
  }, [
    setSelectedLogFile,
    setLogDir,
    initLogDir,
    syncLogs,
    api.log_locations,
    applyHostMessage,
  ]);

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

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;

const AppBootstrapGate: FC = () => {
  const api = useApi();
  const locations = api.log_locations;
  const request = useSyncExternalStore(
    locations?.subscribe ?? noopSubscribe,
    locations?.getRequestSnapshot ?? nullSnapshot,
    locations?.getRequestSnapshot ?? nullSnapshot
  );

  if (locations && request) {
    return <LogLocationGate locations={locations} request={request} />;
  }
  return <AppConfigGate />;
};

/**
 * Renders the Main Application. Owns the query client + api providers so the
 * exported <App> stays self-contained for external embedders.
 */
export const App: FC<AppProps> = ({ api }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <AppBootstrapGate />
      </ApiProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
};

function isHostMessageData(value: unknown): value is HostMessage["data"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const data = value as Record<string, unknown>;
  if (data.type === "updateState") {
    return (
      typeof data.url === "string" &&
      (data.sample_id === undefined || typeof data.sample_id === "string") &&
      (data.sample_epoch === undefined || typeof data.sample_epoch === "string")
    );
  }
  return (
    data.type === "backgroundUpdate" &&
    typeof data.url === "string" &&
    typeof data.log_dir === "string"
  );
}
