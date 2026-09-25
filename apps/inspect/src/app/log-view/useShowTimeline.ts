import { useCallback } from "react";

import { isRecord } from "@tsmono/util";

import { kLogViewTimelineTabId } from "../../constants";
import { useStore } from "../../state/store";
import { useLogNavigationAction } from "../routing/logNavigation";
import { toFullUrlMaybe } from "../routing/url";

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

/**
 * Navigate to the Timeline tab — the in-app target of every "View on
 * timeline" affordance (config chips, connection lanes, popovers). Those
 * render as links to {@link useTimelineHref}, so new-tab gestures never reach
 * this.
 */
export const useShowTimeline = (): (() => void) => {
  const setWorkspaceTab = useStore((state) => state.appActions.setWorkspaceTab);
  const navigation = useLogNavigationAction();
  return useCallback(() => {
    setWorkspaceTab(kLogViewTimelineTabId);
    navigation.selectTab(kLogViewTimelineTabId);
  }, [setWorkspaceTab, navigation]);
};

/** The Timeline tab's URL, for "View on timeline" links. */
export const useTimelineHref = (): string | undefined =>
  toFullUrlMaybe(useLogNavigationAction().getTabUrl(kLogViewTimelineTabId));

/**
 * Navigate to the Timeline tab with a model's Connections band toggled on
 * (the Models tab's deep link). A new tab opened from the link lands on the
 * timeline without the band: the toggle is per-tab state, not in the URL.
 */
export const useShowTimelineForModel = (): ((model: string) => void) => {
  const showTimeline = useShowTimeline();
  const bandsKey = useTimelineBandsKey();
  const setPropertyValue = useStore(
    (state) => state.appActions.setPropertyValue
  );
  const bands = useStore((state) => {
    const stored = state.app.propertyBags[kTimelineBag]?.[bandsKey];
    return isRecord(stored) ? stored : undefined;
  });
  return useCallback(
    (model: string) => {
      const bandId = timelineBandId("connections", model);
      setPropertyValue(kTimelineBag, bandsKey, {
        ...bands,
        [bandId]: true,
      });
      showTimeline();
    },
    [setPropertyValue, bandsKey, bands, showTimeline]
  );
};
