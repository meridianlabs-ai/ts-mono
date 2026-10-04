import { sortingStateToOrderBy } from ".";
import {
  InfiniteData,
  useInfiniteQuery,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { SortingState } from "@tanstack/react-table";

import { Condition } from "../../query";
import { useApi } from "../../state/store";
import { ScansResponse } from "../../types/api-types";

import { scansInfiniteQuery } from "./queries";

export const useScansInfinite = (
  scansDir: string,
  pageSize: number = 50,
  filter?: Condition,
  sorting?: SortingState
): UseInfiniteQueryResult<InfiniteData<ScansResponse>, Error> => {
  const api = useApi();
  const orderBy = sorting ? sortingStateToOrderBy(sorting) : undefined;
  return useInfiniteQuery(
    scansInfiniteQuery(api, scansDir, pageSize, filter, orderBy)
  );
};
