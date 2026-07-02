import { FC, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { kLogViewSamplesTabId } from "../../constants";
import {
  useEvalSpec,
  useSampleSummaries,
  useSelectLogFileAction,
} from "../../state/hooks";
import { useUnloadLogAction } from "../../state/log";
import { useStore } from "../../state/store";
import {
  baseUrl,
  logSamplesUrl,
  useLogRouteParams,
  type RoutePrefix,
} from "../routing/url";

import { LogViewLayout } from "./LogViewLayout";

/**
 * LogContainer component that handles routing to specific logs and tabs.
 * Sample detail URLs are now handled by LogSampleDetailView.
 */
export const LogViewContainer: FC = () => {
  const { logPath, tabId, sampleUuid, sampleTabId } = useLogRouteParams();

  const initialState = useStore((state) => state.app.initialState);
  const clearInitialState = useStore(
    (state) => state.appActions.clearInitialState
  );
  const evalSpec = useEvalSpec();
  const setWorkspaceTab = useStore((state) => state.appActions.setWorkspaceTab);

  const selectLogFile = useSelectLogFileAction();

  const clearSelectedSample = useStore(
    (state) => state.sampleActions.clearSelectedSample
  );

  const navigate = useNavigate();
  const location = useLocation();
  const prefix: RoutePrefix = location.pathname.startsWith("/tasks/")
    ? "/tasks"
    : "/logs";
  const sampleSummaries = useSampleSummaries();
  const [searchParams] = useSearchParams();

  // Unload the log when this is mounted. This prevents the old log
  // data from being displayed when navigating back to the logs panel
  // and also ensures that we reload logs when freshly navigating to them.
  const { unloadLog } = useUnloadLogAction();
  useEffect(() => {
    return () => {
      unloadLog();
    };
  }, [unloadLog]);

  useEffect(() => {
    // Redirect to an id/epoch url if a sampleUuid is provided
    if (logPath && sampleUuid && sampleSummaries) {
      // Find the sample with the matching UUID
      const sample = sampleSummaries.find((s) => s.uuid === sampleUuid);
      if (sample) {
        const url = logSamplesUrl(
          logPath,
          sample.id,
          sample.epoch,
          sampleTabId,
          prefix
        );
        const finalUrl = searchParams.toString()
          ? `${url}?${searchParams.toString()}`
          : url;
        void navigate(finalUrl);
        return;
      }
    }
  }, [
    sampleSummaries,
    logPath,
    sampleUuid,
    searchParams,
    sampleTabId,
    navigate,
    prefix,
  ]);

  useEffect(() => {
    if (initialState && !evalSpec) {
      const url = baseUrl(
        initialState.log,
        initialState.sample_id,
        initialState.sample_epoch,
        prefix
      );
      clearInitialState();
      void navigate(url);
    }
  }, [initialState, evalSpec, clearInitialState, navigate, prefix]);

  const prevLogPathRef = useRef<string | undefined>(undefined);

  // Clear the previous eval's data before paint when the route changes, so the
  // old eval doesn't flash while the new one loads. A useEffect would run after
  // the browser has already painted the stale eval.
  useLayoutEffect(() => {
    const prevLogPath = prevLogPathRef.current;
    prevLogPathRef.current = logPath;
    if (prevLogPath && logPath && logPath !== prevLogPath) {
      clearSelectedSample();
    }
  }, [logPath, clearSelectedSample]);

  // Sync the workspace tab from the URL synchronously. Kept separate from
  // the async log-loading effect below so a tab click can't race with a
  // pending initLogDir() and snap the view back to an older tab.
  useEffect(() => {
    if (!logPath) return;
    setWorkspaceTab(tabId ?? kLogViewSamplesTabId);
  }, [logPath, tabId, setWorkspaceTab]);

  useEffect(() => {
    if (logPath) {
      selectLogFile(logPath);
    }
  }, [logPath, selectLogFile]);

  return <LogViewLayout />;
};
