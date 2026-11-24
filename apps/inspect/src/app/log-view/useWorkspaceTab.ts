import { kLogViewInfoTabId, kLogViewSamplesTabId } from "../../constants";
import { useSelectedLogDetails } from "../../state/hooks";
import { useLogRouteParams } from "../routing/routeParams";

/** The log view's selected tab: the URL's, else a default for the log. */
export const useWorkspaceTab = (): string => {
  const { tabId } = useLogRouteParams();
  const details = useSelectedLogDetails();
  if (tabId) return tabId;
  return details !== undefined &&
    details.status !== "started" &&
    details.sampleCount === 0
    ? kLogViewInfoTabId
    : kLogViewSamplesTabId;
};
