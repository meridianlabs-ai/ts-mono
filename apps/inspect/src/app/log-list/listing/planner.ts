import type { OrderByModel } from "@tsmono/inspect-common/query";

import type { DatabaseListingPlan } from "../../../client/database/listing";

import { compareByOrderBy, evaluateCondition } from "./evaluator";
import type { ListingQuery } from "./types";

/** Compile the wire filter and ordering into record-level listing operations. */
export const createListingPlan = <TRow>(
  query: ListingQuery<TRow>
): DatabaseListingPlan<TRow> => {
  const { filter, getValue, getFilterType, getComparator, pagination } = query;
  const orderBy: OrderByModel[] = query.orderBy
    ? Array.isArray(query.orderBy)
      ? query.orderBy
      : [query.orderBy]
    : [];

  return {
    matches: filter
      ? (row) => evaluateCondition(row, filter, getValue, getFilterType)
      : () => true,
    compare:
      orderBy.length > 0
        ? compareByOrderBy(orderBy, getValue, getComparator)
        : undefined,
    pagination,
  };
};
