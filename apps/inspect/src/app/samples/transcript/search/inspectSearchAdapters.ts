import { useCallback, useMemo } from "react";

import {
  normalizeSearchPanelState,
  type ModelHistoryController,
  type SearchPanelApi,
  type SearchPanelIcons,
  type SearchPanelNavigation,
  type SearchPanelStateController,
  type SearchScope,
  type SearchType,
} from "@tsmono/inspect-components/transcript-search";

import {
  kSampleMessagesTabId,
  kSampleTranscriptTabId,
} from "../../../../constants";
import { useApi, useStore } from "../../../../state/store";
import { useUserSettings } from "../../../../state/userSettings";
import { ApplicationIcons } from "../../../appearance/icons";
import {
  sampleEventUrl,
  sampleMessageUrl,
  useSampleUrlBuilder,
} from "../../../routing/url";

/**
 * inspect_scout's search endpoints (proxied by inspect_ai under /scout/...)
 * are backed by transcripts_view(dir), which:
 *   - accepts a `.eval` file path (file:// prefix stripped) as `dir`
 *   - looks up rows by `transcript_id`, which equals `eval_sample.uuid`
 *
 * Samples without a UUID can't be searched (the human-readable sample.id
 * isn't what the schema indexes by).
 */
const stripFileScheme = (path: string): string =>
  path.startsWith("file://") ? path.slice("file://".length) : path;

export const getInspectSearchPanelStateKey = ({
  scope,
  logFile,
  transcriptId,
}: {
  scope: SearchScope;
  logFile: string;
  transcriptId: string;
}) => `inspect-search-panel:${logFile}:${transcriptId}:${scope}`;

export const useInspectSearchApi = (
  logFile: string,
  transcriptId: string
): SearchPanelApi | null => {
  const api = useApi();
  return useMemo(() => {
    if (
      !api.post_search ||
      !api.get_search_result ||
      !api.list_searches ||
      !transcriptId
    ) {
      return null;
    }
    const transcriptDir = stripFileScheme(logFile);
    return {
      cacheKey: `${transcriptDir}\u0000${transcriptId}`,
      createSearch: (request) =>
        api.post_search!(transcriptDir, transcriptId, request),
      getCachedResult: (searchId, scope) =>
        api.get_search_result!(transcriptDir, transcriptId, searchId, scope),
      listRecentSearches: (searchType: SearchType, count?: number) =>
        api.list_searches!(searchType, count ?? 20),
    };
  }, [api, logFile, transcriptId]);
};

export const useInspectSearchPanelState = ({
  scope,
  logFile,
  transcriptId,
}: {
  scope: SearchScope;
  logFile: string;
  transcriptId: string;
}): SearchPanelStateController => {
  const key = useMemo(
    () => getInspectSearchPanelStateKey({ scope, logFile, transcriptId }),
    [scope, logFile, transcriptId]
  );
  const state = useStore((s) => s.search.panelStates[key])
  const setSearchPanelState = useStore(
    (s) => s.searchActions.setSearchPanelState
  );

  const setState = useCallback<SearchPanelStateController["setState"]>(
    (updater) => {
      setSearchPanelState(key, (prev) =>
        normalizeSearchPanelState(updater(prev))
      );
    },
    [key, setSearchPanelState]
  );

  return { state, setState };
};

export const useInspectSearchModelHistory = (): ModelHistoryController => {
  const history = useUserSettings((s) => s.searchModelHistory);
  const record = useUserSettings((s) => s.recordSearchModel);
  return useMemo(() => ({ history, record }), [history, record]);
};

export const useInspectSearchNavigation = ({
  logPath,
  sampleId,
  sampleEpoch,
}: {
  logPath: string;
  sampleId: string | number;
  sampleEpoch: number;
}): SearchPanelNavigation => {
  const builder = useSampleUrlBuilder();
  return useMemo(
    () => ({
      getEventUrl: (eventId) =>
        sampleEventUrl(builder, eventId, logPath, sampleId, sampleEpoch),
      getMessageUrl: (messageId) =>
        sampleMessageUrl(
          builder,
          messageId,
          logPath,
          sampleId,
          sampleEpoch,
          kSampleMessagesTabId
        ),
      getEventMessageUrl: (messageId) =>
        sampleMessageUrl(
          builder,
          messageId,
          logPath,
          sampleId,
          sampleEpoch,
          kSampleTranscriptTabId
        ),
    }),
    [builder, logPath, sampleId, sampleEpoch]
  );
};

export const INSPECT_SEARCH_ICONS: SearchPanelIcons = {
  search: ApplicationIcons.search,
  history: "bi bi-clock-history",
  add: "bi bi-plus-lg",
  close: ApplicationIcons.close,
};
