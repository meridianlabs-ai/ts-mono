import { useMemo } from "react";
import { Navigate, Outlet, useNavigate } from "react-router";

import {
  AppErrorBoundary,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { createRestorableHashRouter } from "@tsmono/react/routing";
import { basename, isUri } from "@tsmono/util";

import {
  getAppConfig,
  readEmbeddedStartupState,
  useAppConfig,
} from "../../app_config";
import { webviewStorage } from "../../client/storage";
import { kSampleEventTabId } from "../../constants";
import { LogsPanel } from "../log-list/LogsPanel";
import { LogSampleDetailView } from "../log-view/LogSampleDetailView";
import { LogViewContainer } from "../log-view/LogViewContainer";
import { SampleEventView } from "../samples/event/SampleEventView";

import { CurrentSelectionProvider } from "./currentSelection";
import { LoaderMounts } from "./loaders/LoaderHost";
import { RouteDispatcher } from "./RouteDispatcher";
import { SamplesRouter } from "./SamplesRouter";
import {
  baseUrl,
  kLogRouteUrlPattern,
  kLogsRoutUrlPattern as kLogsRouteUrlPattern,
  kTaskRouteUrlPattern,
  kTasksRouteUrlPattern,
  useLogRouteParams,
} from "./url";

const AppLayout = () => {
  const navigate = useNavigate();
  const componentNavigation = useMemo(
    () => ({
      navigate: (path: string, options?: { replace?: boolean }) =>
        navigate(path, options),
    }),
    [navigate]
  );

  // Get route params to check for sample detail routes
  const { sampleId, epoch, sampleTabId, sampleUuid } = useLogRouteParams();

  // Single file mode is a legacy mode that is used when an explicit file is
  // passed via URL (the log_file param) or via embedded state (VSCode). It
  // renders the log/sample view directly rather than through the child route
  // table (which is oriented around the collection).
  //
  // Focus-mode page (must come before the general sample detail check) —
  // mirrors the sibling dispatch points (RouteDispatcher /
  // SamplesRouter), which otherwise never fire here because single-file mode
  // bypasses the Outlet and its child route table.
  const isFocus = sampleId && epoch && sampleTabId === kSampleEventTabId;
  const isSampleDetail = (sampleId && epoch) || sampleUuid;
  const content = useAppConfig().singleFileMode ? (
    isFocus ? (
      <SampleEventView />
    ) : isSampleDetail ? (
      <LogSampleDetailView />
    ) : (
      <LogViewContainer />
    )
  ) : (
    <Outlet />
  );

  return (
    <ComponentNavigationProvider navigation={componentNavigation}>
      <AppErrorBoundary>
        <CurrentSelectionProvider>
          <LoaderMounts>{content}</LoaderMounts>
        </CurrentSelectionProvider>
      </AppErrorBoundary>
    </ComponentNavigationProvider>
  );
};

// Create router with our routes (using hash router for static deployments)
const createAppRouter = () => {
  const embedded = readEmbeddedStartupState();
  const log = embedded?.url
    ? decodeURIComponent(embedded.url)
    : getAppConfig().logFile;
  const initialPath = log
    ? baseUrl(
        isUri(log) ? basename(log) : log,
        embedded?.sample_id,
        embedded?.sample_epoch
      )
    : undefined;
  return createRestorableHashRouter(
    [
      {
        path: "/",
        element: <AppLayout />,
        children: [
          {
            index: true, // This will match exactly the "/" path
            element: <LogsPanel mode="tasks" maybeShowSingleLog={true} />,
          },
          {
            path: kLogsRouteUrlPattern,
            element: <LogsPanel />,
          },
          {
            // This matches all /logs/* paths including sample detail URLs
            // The RouteDispatcher parses the path and routes to the appropriate component
            path: kLogRouteUrlPattern,
            element: <RouteDispatcher />,
          },
          {
            path: kTasksRouteUrlPattern,
            element: <LogsPanel mode="tasks" />,
          },
          {
            path: kTaskRouteUrlPattern,
            element: <RouteDispatcher mode="tasks" />,
          },
          {
            path: "/samples/*",
            element: <SamplesRouter />,
          },
        ],
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
    {
      storage: webviewStorage,
      key: "inspect-route-v1",
      initialPath,
    },
    { basename: "" }
  );
};

// The app owns one router per webview lifetime, including StrictMode remounts.
let appRouter: ReturnType<typeof createAppRouter> | undefined;
export const getAppRouter = () => (appRouter ??= createAppRouter());
