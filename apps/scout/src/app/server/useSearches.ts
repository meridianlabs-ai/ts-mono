import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import type { SearchResultScope } from "../../api/api";
import { useApi } from "../../state/store";
import {
  Result,
  SearchInputListResponse,
  SearchRequest,
  SearchResponse,
} from "../../types/api-types";

type SearchParams = {
  transcriptDir: string;
  transcriptId: string;
};

type SearchInputParams = {
  searchType: SearchRequest["type"];
  count?: number;
};

type CachedSearchResultParams = SearchParams & {
  scope: SearchResultScope;
  searchId: string | null;
};

export const DEFAULT_RECENT_SEARCH_COUNT = 20;

export const searchQueryKeys = {
  searches: ({
    searchType,
    count = DEFAULT_RECENT_SEARCH_COUNT,
  }: SearchInputParams): readonly [
    "searches",
    SearchRequest["type"],
    number,
  ] => ["searches", searchType, count],
  cachedResult: ({
    transcriptDir,
    transcriptId,
    scope,
    searchId,
  }: {
    transcriptDir: string;
    transcriptId: string;
    scope: SearchResultScope;
    searchId: string;
  }): readonly ["search-result", string, string, SearchResultScope, string] => [
    "search-result",
    transcriptDir,
    transcriptId,
    scope,
    searchId,
  ],
};

export const useSearches = (
  params: SearchInputParams
): AsyncData<SearchInputListResponse> => {
  const api = useApi();
  const count = params.count ?? DEFAULT_RECENT_SEARCH_COUNT;

  return useAsyncDataFromQuery({
    queryKey: searchQueryKeys.searches({ ...params, count }),
    queryFn: () => api.getSearches(params.searchType, count),
    staleTime: 60 * 1000,
  });
};

export const useCreateSearch = (params: SearchParams) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<SearchResponse, Error, SearchRequest>({
    mutationFn: (request) =>
      api.postSearch(params.transcriptDir, params.transcriptId, request),
    onSuccess: (_result, request) => {
      void queryClient.invalidateQueries({
        queryKey: searchQueryKeys.searches({ searchType: request.type }),
      });
    },
  });
};

export const useCachedSearchResult = (params: CachedSearchResultParams) => {
  const api = useApi();
  const { transcriptDir, transcriptId, scope, searchId } = params;

  return useQuery<Result | null, Error>({
    queryKey: searchId
      ? searchQueryKeys.cachedResult({
          transcriptDir,
          transcriptId,
          scope,
          searchId,
        })
      : ["search-result", "disabled"],
    queryFn: () =>
      api.getSearchResult(transcriptDir, transcriptId, searchId!, scope),
    enabled: !!searchId,
    staleTime: Infinity,
  });
};
