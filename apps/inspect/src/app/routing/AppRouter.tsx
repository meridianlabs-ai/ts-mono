import { useEffect, useMemo } from "react";
import {
  createHashRouter,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  AppErrorBoundary,
  ComponentNavigationProvider,
  PulsingDots,
} from "@tsmono/react/components";

import { storeImplementation } from "../../state/store";
import { LogsPanel } from "../log-list/LogsPanel";
import { LogSampleDetailView } from "../log-view/LogSampleDetailView";
import { LogViewContainer } from "../log-view/LogViewContainer";
import { useLogRootAsync } from "../server/useLogDir";
import { isSingleFileMode } from "../singleFileMode";

import { ReplicationController } from "./ReplicationController";
import { RouteDispatcher } from "./RouteDispatcher";
import { SamplesRouter } from "./SamplesRouter";
import { TasksRouter } from "./TasksRouter";
import {
  kLogRouteUrlPattern,
  kLogsRoutUrlPattern as kLogsRouteUrlPattern,
  kTaskRouteUrlPattern,
  kTasksRouteUrlPattern,
  useLogRouteParams,
} from "./url";

// Create a layout component that includes the RouteTracker
const AppLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const componentNavigation = useMemo(
    () => ({
      navigate: (path: string, options?: { replace?: boolean }) =>
        navigate(path, options),
    }),
    [navigate]
  );

  // Track changes to routes
  useEffect(() => {
    if (storeImplementation) {
      storeImplementation.getState().appActions.setUrlHash(location.pathname);
    }
  }, [location]);

  // Get route params to check for sample detail routes
  const { sampleId, epoch, sampleUuid } = useLogRouteParams();

  // Single file mode is a legacy mode that is used when an explicit
  // file is passed via URL (task_file or log_file params) or via
  // embedded state (VSCode)
  if (isSingleFileMode) {
    // Check if this is a sample detail URL
    const isSampleDetail = (sampleId && epoch) || sampleUuid;

    return (
      <ComponentNavigationProvider navigation={componentNavigation}>
        <AppErrorBoundary>
          {isSampleDetail ? <LogSampleDetailView /> : <LogViewContainer />}
        </AppErrorBoundary>
      </ComponentNavigationProvider>
    );
  }

  return (
    <ComponentNavigationProvider navigation={componentNavigation}>
      <AppErrorBoundary>
        <DirModeContent />
      </AppErrorBoundary>
    </ComponentNavigationProvider>
  );
};

/**
 * Dir-mode gate: resolves the server log root once (via the gated `["log-dir"]`
 * query) before rendering the collection/log routes, and owns the dir-mode
 * replication lifecycle through <ReplicationController>. The single-file branch
 * of AppLayout never reaches here (its log dir is route-derived).
 */
const DirModeContent = () => {
  const logRoot = useLogRootAsync();

  if (logRoot.error) {
    return (
      <div className="app-config-gate">
        Failed to load log directory: {logRoot.error.message}
      </div>
    );
  }
  if (logRoot.loading) {
    return (
      <div className="app-config-gate">
        <PulsingDots size="large" text="Loading logs…" />
      </div>
    );
  }

  const logDir = logRoot.data?.log_dir;
  return (
    <>
      {logDir ? <ReplicationController key={logDir} logDir={logDir} /> : null}
      <Outlet />
    </>
  );
};

// Create router with our routes (using hash router for static deployments)
export const AppRouter = createHashRouter(
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
          element: <TasksRouter />,
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
  { basename: "" }
);
