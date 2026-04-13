import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import {
  SavedSearch,
  SavedSearchListResponse,
  SearchRequest,
} from "../../types/api-types";

type SearchParams = {
  transcriptDir: string;
  transcriptId: string;
};

export const searchQueryKeys = {
  searches: ({ transcriptDir, transcriptId }: SearchParams) =>
    ["searches", transcriptDir, transcriptId] as const,
};

export const useSearches = (
  params: SearchParams
): AsyncData<SavedSearchListResponse> => {
  const api = useApi();

  return useAsyncDataFromQuery({
    queryKey: searchQueryKeys.searches(params),
    queryFn: () => api.getSearches(params.transcriptDir, params.transcriptId),
    staleTime: 60 * 1000,
  });
};

export const useCreateSearch = (params: SearchParams) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<SavedSearch, Error, SearchRequest>({
    mutationFn: (request) =>
      api.postSearch(params.transcriptDir, params.transcriptId, request),
    onSuccess: (savedSearch) => {
      queryClient.setQueryData<SavedSearchListResponse>(
        searchQueryKeys.searches(params),
        (current) => {
          const items = [
            savedSearch,
            ...(current?.items ?? []).filter(
              (search) => search.search_id !== savedSearch.search_id
            ),
          ];

          return current ? { ...current, items } : { items };
        }
      );
    },
  });
};
