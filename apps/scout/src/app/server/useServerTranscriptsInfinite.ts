import { sortingStateToOrderBy } from ".";
import {
  InfiniteData,
  skipToken,
  useInfiniteQuery,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { SortingState } from "@tanstack/react-table";

import { Condition } from "../../query";
import { useApi } from "../../state/store";
import { TranscriptsResponse } from "../../types/api-types";

import { transcriptsInfiniteQuery } from "./queries";

type ServerTranscriptsInfiniteParams = {
  location: string;
  pageSize?: number;
  filter?: Condition;
  sorting?: SortingState;
};

export const useServerTranscriptsInfinite = (
  params: ServerTranscriptsInfiniteParams | typeof skipToken
): UseInfiniteQueryResult<InfiniteData<TranscriptsResponse>, Error> => {
  const api = useApi();
  return useInfiniteQuery(
    transcriptsInfiniteQuery(
      api,
      params === skipToken
        ? skipToken
        : {
            location: params.location,
            pageSize: params.pageSize ?? 50,
            filter: params.filter,
            orderBy: params.sorting
              ? sortingStateToOrderBy(params.sorting)
              : undefined,
          }
    )
  );
};
