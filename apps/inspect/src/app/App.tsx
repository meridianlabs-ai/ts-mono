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

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import ClipboardJS from "clipboard";
import { FC, useCallback, useEffect, useLayoutEffect } from "react";
import { RouterProvider } from "react-router-dom";

import {
  AsyncGate,
  ComponentIconProvider,
  ComponentIcons,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { basename } from "@tsmono/util";

import { ClientAPI, HostMessage } from "../client/api/types.ts";
import { inspectStateHooks } from "../state/componentStateAdapter";
import { queryClient } from "../state/queryClient.ts";
import { ApiProvider, useApi, useStore } from "../state/store.ts";
import {
  SETTINGS_STORAGE_KEY,
  useUserSettings,
} from "../state/userSettings.ts";
import { isUri } from "../utils/uri.ts";

import { ApplicationIcons } from "./appearance/icons.ts";
import { AppRouter } from "./routing/AppRouter.tsx";
import { useAppConfigAsync } from "./server/useAppConfig.ts";
import {
  pushLogDirForEmbeddedMode,
  useLogDirAsync,
} from "./server/useLogDir.ts";
import { resolveEmbeddedLogDir } from "./singleFileMode.ts";

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

  // Above the loader gate, so the dir may be unresolved; used only for the
  // host-message comparison below. Selecting + loading the log is owned by
  // <LogLoadController>, below the gate.
  const logDir = useLogDirAsync().data;

  const setInitialState = useStore((state) => state.appActions.setInitialState);

  const syncLogs = useStore((state) => state.logsActions.syncLogs);
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );

  const onMessage = useCallback(
    (e: HostMessage) => {
      switch (e.data.type) {
        case "updateState": {
          if (e.data.url) {
            const decodedUrl = decodeURIComponent(e.data.url);

            let targetFile = decodedUrl;
            if (isUri(targetFile)) {
              targetFile = basename(targetFile);
            }
            // Push the host-opened dir so <LoaderGate>'s gate resolves.
            pushLogDirForEmbeddedMode(resolveEmbeddedLogDir(decodedUrl));

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
              void api.open_log_file(e.data.url, e.data.log_dir);
            }
          } else {
            void syncLogs();
          }
          break;
        }
      }
    },
    [setInitialState, logDir, setSelectedLogFile, api, syncLogs, rehydrated]
  );

  // listen for updateState messages from vscode
  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [onMessage]);

  useEffect(() => {
    // Embedded state (VS Code) is the host-message bootstrap and feeds the same
    // onMessage bridge as live postMessage events. The URL-param single-file
    // deep link (`?log_file=`) is handled by <LoaderHost>.
    const embeddedState = document.getElementById("logview-state");
    if (embeddedState) {
      const state = JSON5.parse<HostMessage["data"]>(
        embeddedState.textContent || ""
      );
      onMessage({ data: state } as HostMessage);
    }

    new ClipboardJS(".clipboard-button,.copy-button");
  }, [onMessage]);

  return (
    <ComponentIconProvider icons={componentIcons}>
      <ComponentStateProvider hooks={inspectStateHooks}>
        <RouterProvider router={AppRouter} />
      </ComponentStateProvider>
    </ComponentIconProvider>
  );
};

const AppConfigGate: FC = () => (
  <AsyncGate
    async={useAppConfigAsync()}
    errorLabel="Failed to load application configuration"
    loadingText="Loading application…"
  >
    <AppContent />
  </AsyncGate>
);

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
