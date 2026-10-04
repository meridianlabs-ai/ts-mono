import { sortingStateToOrderBy } from ".";
import { SortingState } from "@tanstack/react-table";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { Condition } from "../../query";
import { useApi } from "../../state/store";
import { TranscriptsResponse } from "../../types/api-types";

import { transcriptsQuery } from "./queries";

export const useServerTranscripts = (
  location: string,
  filter?: Condition,
  sorting?: SortingState
): AsyncData<TranscriptsResponse> => {
  const api = useApi();
  const orderBy = sorting ? sortingStateToOrderBy(sorting) : undefined;
  return useAsyncDataFromQuery(
    transcriptsQuery(api, location, filter, orderBy)
  );
};
