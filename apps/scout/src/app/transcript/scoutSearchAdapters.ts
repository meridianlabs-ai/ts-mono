import { useCallback, useMemo } from "react";

import {
  normalizeSearchPanelState,
  type ModelHistoryController,
  type SearchPanelApi,
  type SearchPanelNavigation,
  type SearchPanelStateController,
  type SearchScope,
  type SearchType,
} from "@tsmono/inspect-components/transcript-search";

import { useApi, useStore } from "../../state/store";
import { useUserSettings } from "../../state/userSettings";

import { useTranscriptNavigation } from "./hooks/useTranscriptNavigation";

export const getSearchPanelStateKey = ({
  scope,
  transcriptDir,
}: {
  scope: SearchScope;
  transcriptDir: string;
}) => `search-panel:${transcriptDir}:${scope}`;

const buildCacheKey = (transcriptDir: string, transcriptId: string) =>
  `${transcriptDir}\u0000${transcriptId}`;

export const useScoutSearchApi = (
  transcriptDir: string,
  transcriptId: string
): SearchPanelApi => {
  const api = useApi();
  return useMemo(
    () => ({
      cacheKey: buildCacheKey(transcriptDir, transcriptId),
      createSearch: (request) =>
        api.postSearch(transcriptDir, transcriptId, request),
      getCachedResult: (searchId, scope) =>
        api.getSearchResult(transcriptDir, transcriptId, searchId, scope),
      listRecentSearches: (searchType: SearchType, count?: number) =>
        api.getSearches(searchType, count ?? 20),
    }),
    [api, transcriptDir, transcriptId]
  );
};

export const useScoutSearchPanelState = ({
  scope,
  transcriptDir,
}: {
  scope: SearchScope;
  transcriptDir: string;
}): SearchPanelStateController => {
  const key = useMemo(
    () => getSearchPanelStateKey({ scope, transcriptDir }),
    [scope, transcriptDir]
  );
  const stored = useStore((s) => s.searchPanelStates[key]);
  const setSearchPanelState = useStore((s) => s.setSearchPanelState);

  const state = useMemo(() => normalizeSearchPanelState(stored), [stored]);
  const setState = useCallback<SearchPanelStateController["setState"]>(
    (updater) => setSearchPanelState(key, updater),
    [key, setSearchPanelState]
  );

  return useMemo(() => ({ state, setState }), [state, setState]);
};

export const useScoutSearchModelHistory = (): ModelHistoryController => {
  const history = useUserSettings((s) => s.searchModelHistory);
  const record = useUserSettings((s) => s.recordSearchModel);
  return useMemo(() => ({ history, record }), [history, record]);
};

export const useScoutSearchNavigation = (): SearchPanelNavigation => {
  const { getMessageUrl, getEventUrl, getEventMessageUrl } =
    useTranscriptNavigation();
  return useMemo(
    () => ({ getMessageUrl, getEventUrl, getEventMessageUrl }),
    [getMessageUrl, getEventUrl, getEventMessageUrl]
  );
};
