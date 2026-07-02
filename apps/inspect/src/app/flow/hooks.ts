import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useAppConfig } from "../../app_config";

/**
 * The flow definition for `dir`. Keyed on the dir so navigation re-fetches;
 * `staleTime: Infinity` because a dir's flow doesn't change under a fixed dir.
 */
export const useFlowQuery = (dir: string): AsyncData<string | undefined> => {
  const api = useAppConfig().api;
  return useAsyncDataFromQuery({
    queryKey: ["flow", dir],
    // react-query errors on an `undefined` queryFn result ("data is
    // undefined"), so a missing flow must be *stored* as `null`; `select`
    // converts it back so `null` never leaks to consumers.
    queryFn: async () => (await api.get_flow(dir)) ?? null,
    select: (flow) => flow ?? undefined,
    staleTime: Infinity,
  });
};
