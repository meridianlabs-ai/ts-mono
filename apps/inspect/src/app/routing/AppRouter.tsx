import { useEffect, useMemo } from "react";
import {
  createHashRouter,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { ComponentNavigationProvider } from "@tsmono/react/components";

import { storeImplementation, useStore } from "../../state/store";
import { AppErrorBoundary } from "../AppErrorBoundary";
import { LogsPanel } from "../log-list/LogsPanel";
import { LogSampleDetailView } from "../log-view/LogSampleDetailView";
import { LogViewContainer } from "../log-view/LogViewContainer";
import { TasksPanel } from "../tasks-panel/TasksPanel";

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
    () => ({ navigate: (path: string) => navigate(path) }),
    [navigate]
  );

  // Track changes to routes
  useEffect(() => {
    if (storeImplementation) {
      storeImplementation.getState().appActions.setUrlHash(location.pathname);
    }
  }, [location]);

  // Get log selection state from store
  const singleFileMode = useStore((state) => state.app.singleFileMode);

  // Get route params to check for sample detail routes
  const { sampleId, epoch, sampleUuid } = useLogRouteParams();

  // Single file mode is a legacy mode that is used when an explicit
  // file is passed via URL (task_file or log_file params) or via
  // embedded state (VSCode)
  if (singleFileMode) {
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
        <Outlet />
      </AppErrorBoundary>
    </ComponentNavigationProvider>
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
          element: <LogsPanel maybeShowSingleLog={true} />,
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
          element: <TasksPanel />,
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
