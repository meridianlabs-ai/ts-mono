import { useCallback, useMemo } from "react";
import { Outlet, useParams } from "react-router";

import {
  ComponentNavigationProvider,
  FindBand,
  useFindBandShortcut,
} from "@tsmono/react/components";
import { createRestorableHashRouter } from "@tsmono/react/routing";
import { createWebviewStorage, getVscodeApi } from "@tsmono/util";

import { ActivityBarLayout } from "./app/components/ActivityBarLayout";
import {
  embeddedRoute,
  getEmbeddedAppMessage,
  useWindowMessaging,
} from "./app/hooks/useWindowMessaging";
import { ProjectPanel } from "./app/project/ProjectPanel";
import { RunScanPanel } from "./app/runScan/RunScanPanel";
import { ScanPanel } from "./app/scan/ScanPanel";
import { ScannerResultPanel } from "./app/scannerResult/ScannerResultPanel";
import { ScansPanel } from "./app/scans/ScansPanel";
import { useAppConfig } from "./app/server/useAppConfig";
import { TranscriptEventPanel } from "./app/transcript/TranscriptEventPanel";
import { TranscriptPanel } from "./app/transcript/TranscriptPanel";
import { TranscriptsPanel } from "./app/transcripts/TranscriptsPanel";
import { ValidationPanel } from "./app/validation/ValidationPanel";
import {
  LoggingNavigate,
  useLoggingNavigate,
} from "./debugging/navigationDebugging";
import { readLegacyRoute } from "./router/legacyRoute";
import {
  isValidScanPath,
  kProjectRouteUrlPattern,
  kScanRouteUrlPattern,
  kScansRootRouteUrlPattern,
  kScansRouteUrlPattern,
  kScansWithPathRouteUrlPattern,
  kTranscriptDetailRoute,
  kTranscriptEventDetailRoute,
  kTranscriptsRouteUrlPattern,
  kValidationRouteUrlPattern,
  parseScanParams,
  scansRoute,
} from "./router/url";
import { useStore } from "./state/store";
import { AppConfig } from "./types/api-types";

export interface AppRouterConfig {
  mode: "scans" | "workbench";
  config: AppConfig;
}

const createAppLayout = (routerConfig: AppRouterConfig) => {
  const AppLayout = () => {
    const showFind = useStore((state) => state.showFind);
    const setShowFind = useStore((state) => state.setShowFind);
    const singleFileMode = useStore((state) => state.singleFileMode);
    const config = useAppConfig();

    const navigate = useLoggingNavigate("AppLayout");
    const componentNavigation = useMemo(() => ({ navigate }), [navigate]);

    const openFind = useCallback(() => setShowFind(true), [setShowFind]);
    const closeFind = useCallback(() => setShowFind(false), [setShowFind]);
    // No onClose: scout has never had a global Escape handler — the band
    // closes via its own input's Escape or the close button.
    useFindBandShortcut(openFind);
    useWindowMessaging();

    const content = <Outlet />;
    return (
      <ComponentNavigationProvider navigation={componentNavigation}>
        {showFind && <FindBand onClose={closeFind} debounceMs={300} />}

        {routerConfig.mode === "workbench" && !singleFileMode ? (
          <ActivityBarLayout config={config}>{content}</ActivityBarLayout>
        ) : (
          content
        )}
      </ComponentNavigationProvider>
    );
  };

  return AppLayout;
};

// Wrapper component that validates scan path before rendering
const ScanOrScanResultsRoute = () => {
  const params = useParams<{ scansDir?: string; "*": string }>();
  const { scansDir, relativePath, scanResultUuid } = parseScanParams(params);

  // If there's a scan result UUID, render the ScanResultPanel
  if (scanResultUuid) {
    return <ScannerResultPanel />;
  }

  // Validate that the path ends with the correct scan_id pattern
  if (!isValidScanPath(relativePath)) {
    // Redirect to /scans preserving the path structure
    return (
      <LoggingNavigate
        to={scansDir ? scansRoute(scansDir, relativePath) : "/scans"}
        replace
        reason="Invalid scan path"
      />
    );
  }

  return <ScanPanel />;
};

const ProjectPanelRoute = () => {
  const config = useAppConfig();
  return <ProjectPanel config={config} />;
};

export const createAppRouter = (config: AppRouterConfig) => {
  const AppLayout = createAppLayout(config);
  const transcriptsDir = config.config.transcripts;

  const vscode = getVscodeApi();
  const storage = vscode ? createWebviewStorage(vscode) : undefined;
  const initialPath = embeddedRoute(
    getEmbeddedAppMessage(),
    config.config.scans.dir
  );
  return createRestorableHashRouter(
    [
      {
        path: "/",
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: (
              <LoggingNavigate
                to={transcriptsDir ? "/transcripts" : "/scans"}
                replace
                reason="Root index redirect"
              />
            ),
          },
          {
            path: kScansRootRouteUrlPattern,
            element: <ScansPanel />,
          },
          {
            path: kScansRouteUrlPattern,
            element: <ScansPanel />,
          },
          {
            path: kScansWithPathRouteUrlPattern,
            element: <ScansPanel />,
          },
          {
            path: kScanRouteUrlPattern,
            element: <ScanOrScanResultsRoute />,
          },
          {
            path: kTranscriptsRouteUrlPattern,
            element: <TranscriptsPanel />,
          },
          {
            path: kProjectRouteUrlPattern,
            element: <ProjectPanelRoute />,
          },
          {
            path: kValidationRouteUrlPattern,
            element: <ValidationPanel />,
          },
          {
            path: kTranscriptEventDetailRoute,
            element: <TranscriptEventPanel />,
          },
          {
            path: kTranscriptDetailRoute,
            element: <TranscriptPanel />,
          },
          {
            path: "/run",
            element: <RunScanPanel />,
          },
        ],
      },
      {
        path: "*",
        element: <LoggingNavigate to="/scans" replace reason="catch-all" />,
      },
    ],
    {
      storage,
      key: "scout-route-v1",
      initialPath,
      legacyPath: readLegacyRoute(storage, config.config.scans.dir),
    },
    { basename: "" }
  );
};
