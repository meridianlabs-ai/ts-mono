import { useCallback } from "react";

import { useLogDir } from "../../app_config";
import { kLogViewTimelineTabId } from "../../constants";
import { useStore } from "../../state/store";
import { useLogNavigationAction } from "../routing/logNavigation";
import { logsUrl, useRoutePrefix } from "../routing/url";
import { openInNewTab } from "../shared/openInNewTab";

// Timeline tab UI state (band toggles, filters, search, sort, selection),
// keyed per log so it doesn't leak between logs viewed in the same session.
export const kTimelineBag = "timeline";
const kTimelineBandsKey = "bands";
export const timelineBandId = (band: string, model?: string): string =>
  model ? `${band}:${model}` : band;

/** A timeline property key scoped to the log currently in view. */
export const useTimelineLogKey = (name: string): string => {
  // The app routes are splat patterns, so no logPath param exists —
  // loadedLog is the only source for the log in view.
  const loadedLog = useStore((state) => state.log.loadedLog);
  return `${name}:${loadedLog ?? ""}`;
};

/** The band-picker property key for the log currently in view. */
export const useTimelineBandsKey = (): string =>
  useTimelineLogKey(kTimelineBandsKey);

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
  const logDir = useLogDir();
  const loadedLog = useStore((state) => state.log.loadedLog);
  const prefix = useRoutePrefix();
  return useCallback(
    (event?: NavClickEvent) => {
      if (event && (event.metaKey || event.ctrlKey || event.shiftKey)) {
        const url = loadedLog
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
    [setWorkspaceTab, navigation, loadedLog, logDir, prefix]
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
        Record<string, boolean> | undefined
  );
  return useCallback(
    (model: string, event?: NavClickEvent) => {
      // Modifier clicks open a new browser tab that doesn't share this
      // store — writing the toggle here would silently flip the band in
      // the *current* tab instead, so only in-app navigation writes it.
      const newTab =
        !!event && (event.metaKey || event.ctrlKey || event.shiftKey);
      if (!newTab) {
        const bandId = timelineBandId("connections", model);
        setPropertyValue(kTimelineBag, bandsKey, {
          ...bands,
          [bandId]: true,
        });
      }
      showTimeline(event);
    },
    [setPropertyValue, bandsKey, bands, showTimeline]
  );
};
