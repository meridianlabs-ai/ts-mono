import { useCallback } from "react";
import { useParams } from "react-router-dom";

import { useLogDir } from "../../app_config";
import { kLogViewTimelineTabId } from "../../constants";
import { useStore } from "../../state/store";
import { useLogNavigationAction } from "../routing/logNavigation";
import { logsUrl, logsUrlRaw, useRoutePrefix } from "../routing/url";
import { openInNewTab } from "../shared/openInNewTab";

// Timeline band-picker state, keyed per log so toggles don't leak between
// logs viewed in the same session.
export const kTimelineBag = "timeline";
const kTimelineBandsKey = "bands";
export const timelineBandId = (band: string, model?: string): string =>
  model ? `${band}:${model}` : band;

/** The band-picker property key for the log currently in view. */
export const useTimelineBandsKey = (): string => {
  const { logPath } = useParams<{ logPath: string }>();
  const loadedLog = useStore((state) => state.log.loadedLog);
  return `${kTimelineBandsKey}:${logPath ?? loadedLog ?? ""}`;
};

/** The modifier keys that turn a navigation click into open-in-new-tab. */
export interface NavClickEvent {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * Navigate to the Timeline tab — the target of every "View on timeline"
 * affordance (config chips, connection lanes, popovers). Cmd/ctrl/shift
 * click opens the tab in a new browser tab instead.
 */
export const useShowTimeline = (): ((event?: NavClickEvent) => void) => {
  const setWorkspaceTab = useStore((state) => state.appActions.setWorkspaceTab);
  const navigation = useLogNavigationAction();
  const { logPath } = useParams<{ logPath: string }>();
  const logDir = useLogDir();
  const loadedLog = useStore((state) => state.log.loadedLog);
  const prefix = useRoutePrefix();
  return useCallback(
    (event?: NavClickEvent) => {
      if (event && (event.metaKey || event.ctrlKey || event.shiftKey)) {
        const url = logPath
          ? logsUrlRaw(logPath, kLogViewTimelineTabId, prefix)
          : loadedLog
            ? logsUrl(loadedLog, logDir, kLogViewTimelineTabId, prefix)
            : undefined;
        if (url) {
          openInNewTab(url);
          return;
        }
      }
      setWorkspaceTab(kLogViewTimelineTabId);
      navigation.selectTab(kLogViewTimelineTabId);
    },
    [setWorkspaceTab, navigation, logPath, loadedLog, logDir, prefix]
  );
};

/**
 * Navigate to the Timeline tab with a model's Connections band toggled on
 * (the Models tab's deep link).
 */
export const useShowTimelineForModel = (): ((
  model: string,
  event?: NavClickEvent
) => void) => {
  const showTimeline = useShowTimeline();
  const bandsKey = useTimelineBandsKey();
  const setPropertyValue = useStore(
    (state) => state.appActions.setPropertyValue
  );
  const bands = useStore(
    (state) =>
      state.app.propertyBags[kTimelineBag]?.[bandsKey] as
        | Record<string, boolean>
        | undefined
  );
  return useCallback(
    (model: string, event?: NavClickEvent) => {
      setPropertyValue(kTimelineBag, bandsKey, {
        ...bands,
        [timelineBandId("connections", model)]: true,
      });
      showTimeline(event);
    },
    [setPropertyValue, bandsKey, bands, showTimeline]
  );
};
