import { useCallback } from "react";

import { kLogViewTimelineTabId } from "../../constants";
import { useStore } from "../../state/store";
import { useLogNavigationAction } from "../routing/logNavigation";

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
