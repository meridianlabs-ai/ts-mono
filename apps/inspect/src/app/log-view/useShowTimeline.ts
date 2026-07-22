import { useCallback } from "react";

import { kLogViewTimelineTabId } from "../../constants";
import { useStore } from "../../state/store";
import { useLogNavigationAction } from "../routing/logNavigation";

// Timeline band-picker state (per-log view storage, cf. usage-connections).
export const kTimelineBag = "timeline";
export const kTimelineBandsKey = "bands";
export const timelineBandId = (band: string, model?: string): string =>
  model ? `${band}:${model}` : band;

/**
 * Navigate to the Timeline tab — the target of every "View on timeline"
 * affordance (config chips, connection lanes, popovers).
 */
export const useShowTimeline = (): (() => void) => {
  const setWorkspaceTab = useStore((state) => state.appActions.setWorkspaceTab);
  const navigation = useLogNavigationAction();
  return useCallback(() => {
    setWorkspaceTab(kLogViewTimelineTabId);
    navigation.selectTab(kLogViewTimelineTabId);
  }, [setWorkspaceTab, navigation]);
};

/**
 * Navigate to the Timeline tab with a model's Connections band toggled on
 * (the Models tab's deep link).
 */
export const useShowTimelineForModel = (): ((model: string) => void) => {
  const showTimeline = useShowTimeline();
  const setPropertyValue = useStore(
    (state) => state.appActions.setPropertyValue
  );
  const bands = useStore(
    (state) =>
      state.app.propertyBags[kTimelineBag]?.[kTimelineBandsKey] as
        | Record<string, boolean>
        | undefined
  );
  return useCallback(
    (model: string) => {
      setPropertyValue(kTimelineBag, kTimelineBandsKey, {
        ...bands,
        [timelineBandId("connections", model)]: true,
      });
      showTimeline();
    },
    [setPropertyValue, bands, showTimeline]
  );
};
