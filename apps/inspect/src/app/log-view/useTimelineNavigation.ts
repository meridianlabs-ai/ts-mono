import { useCallback } from "react";

import { isRecord } from "@tsmono/util";

import { kLogViewTimelineTabId } from "../../constants";
import { useStore } from "../../state/store";
import { useCurrentLogFile } from "../routing/currentSelection";
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
  const logFile = useCurrentLogFile();
  return `${name}:${logFile ?? ""}`;
};

/** The band-picker property key for the log currently in view. */
export const useTimelineBandsKey = (): string =>
  useTimelineLogKey(kTimelineBandsKey);

/** Where a "View on timeline" link goes, and the in-app navigation there. */
export interface TimelineNavigation<Args extends unknown[] = []> {
  href: string | undefined;
  show: (...args: Args) => void;
}

/**
 * The Timeline tab as the target of every "View on timeline" affordance
 * (config chips, connection lanes, popovers): its URL for the link, and the
 * in-app navigation for plain clicks.
 */
export const useTimelineNavigation = (): TimelineNavigation => {
  const setWorkspaceTab = useStore((state) => state.appActions.setWorkspaceTab);
  const navigation = useLogNavigationAction();
  const show = useCallback(() => {
    setWorkspaceTab(kLogViewTimelineTabId);
    navigation.selectTab(kLogViewTimelineTabId);
  }, [setWorkspaceTab, navigation]);
  return {
    href: toFullUrlMaybe(navigation.getTabUrl(kLogViewTimelineTabId)),
    show,
  };
};

/**
 * The Timeline tab with a model's Connections band toggled on (the Models
 * tab's deep link). A new tab opened from the link lands on the timeline
 * without the band: the toggle is per-tab state, not in the URL.
 */
export const useTimelineNavigationForModel = (): TimelineNavigation<
  [model: string]
> => {
  const { href, show: showTimeline } = useTimelineNavigation();
  const bandsKey = useTimelineBandsKey();
  const setPropertyValue = useStore(
    (state) => state.appActions.setPropertyValue
  );
  const bands = useStore((state) => {
    const stored = state.app.propertyBags[kTimelineBag]?.[bandsKey];
    return isRecord(stored) ? stored : undefined;
  });
  const show = useCallback(
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
  return { href, show };
};
