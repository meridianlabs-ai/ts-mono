import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import type { SearchResultScope } from "../../api/api";
import { useApi } from "../../state/store";
import {
  Result,
  SearchInputListResponse,
  SearchRequest,
} from "../../types/api-types";

type SearchParams = {
  transcriptDir: string;
  transcriptId: string;
};

type SearchInputParams = {
  searchType: SearchRequest["type"];
  count?: number;
};

type CachedSearchResultRequest = {
  searchId: string;
  scope: SearchResultScope;
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

  return useMutation<Result, Error, SearchRequest>({
    mutationFn: (request) =>
      api.postSearch(params.transcriptDir, params.transcriptId, request),
    onSuccess: (_result, request) => {
      void queryClient.invalidateQueries({
        queryKey: searchQueryKeys.searches({ searchType: request.type }),
      });
    },
  });
};

export const useCachedSearchResult = (params: SearchParams) => {
  const api = useApi();

  return useMutation<Result | null, Error, CachedSearchResultRequest>({
    mutationFn: (request) =>
      api.getSearchResult(
        params.transcriptDir,
        params.transcriptId,
        request.searchId,
        request.scope
      ),
  });
};
