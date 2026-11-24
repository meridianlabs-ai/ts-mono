import { LogHeader } from "../../client/api/types";
import { kLogViewInfoTabId, kLogViewSamplesTabId } from "../../constants";
import { useSelectedLogDetails } from "../../state/hooks";
import { useLogRouteParams } from "../routing/routeParams";

/**
 * The log view's selected tab: the URL's when the log renders it (Error only
 * exists for errored logs), else a default for the log.
 */
export const workspaceTab = (
  urlTab: string | undefined,
  renderedTabs: readonly string[],
  details: Pick<LogHeader, "status" | "sampleCount"> | undefined
): string => {
  if (urlTab && renderedTabs.includes(urlTab)) return urlTab;
  return details !== undefined &&
    details.status !== "started" &&
    details.sampleCount === 0
    ? kLogViewInfoTabId
    : kLogViewSamplesTabId;
};

export const useWorkspaceTab = (renderedTabs: readonly string[]): string =>
  workspaceTab(
    useLogRouteParams().tabId,
    renderedTabs,
    useSelectedLogDetails()
  );
