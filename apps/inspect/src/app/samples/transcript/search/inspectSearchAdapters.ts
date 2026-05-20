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
  type StoredSearchPanelState,
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
 * Inspect's search endpoints are inspect_ai's `/scout/...` routes. The path
 * params `dir` and `id` are passed through opaquely from the React adapter
 * to the API client; only the API client is responsible for URL encoding.
 *
 * For Inspect, we map:
 *   transcriptDir = log_file        (raw path; encoded by view-server)
 *   transcriptId  = `${sample_id}|${epoch}`   (synthetic per-sample identity)
 *
 * If the inspect_ai backend expects a different shape, change this single
 * mapping — the rest of the wiring is identity-agnostic.
 */
const buildTranscriptId = (
  sampleId: string | number,
  sampleEpoch: number
): string => `${sampleId}|${sampleEpoch}`;

export const getInspectSearchPanelStateKey = ({
  scope,
  logFile,
  sampleId,
  sampleEpoch,
}: {
  scope: SearchScope;
  logFile: string;
  sampleId: string | number;
  sampleEpoch: number;
}) => `inspect-search-panel:${logFile}:${sampleId}:${sampleEpoch}:${scope}`;

export const useInspectSearchApi = (
  logFile: string,
  sampleId: string | number,
  sampleEpoch: number
): SearchPanelApi | null => {
  const api = useApi();
  return useMemo(() => {
    if (
      !api.post_search ||
      !api.get_search_result ||
      !api.list_searches
    ) {
      return null;
    }
    const transcriptId = buildTranscriptId(sampleId, sampleEpoch);
    return {
      cacheKey: `${logFile}\u0000${transcriptId}`,
      createSearch: (request) =>
        api.post_search!(logFile, transcriptId, request),
      getCachedResult: (searchId, scope) =>
        api.get_search_result!(logFile, transcriptId, searchId, scope),
      listRecentSearches: (searchType: SearchType, count?: number) =>
        api.list_searches!(searchType, count ?? 20),
    };
  }, [api, logFile, sampleId, sampleEpoch]);
};

export const useInspectSearchPanelState = ({
  scope,
  logFile,
  sampleId,
  sampleEpoch,
}: {
  scope: SearchScope;
  logFile: string;
  sampleId: string | number;
  sampleEpoch: number;
}): SearchPanelStateController => {
  const key = useMemo(
    () =>
      getInspectSearchPanelStateKey({
        scope,
        logFile,
        sampleId,
        sampleEpoch,
      }),
    [scope, logFile, sampleId, sampleEpoch]
  );
  const state = useStore((s) => s.search.panelStates[key]) as
    | StoredSearchPanelState
    | undefined;
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
