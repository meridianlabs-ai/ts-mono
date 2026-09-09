import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useAppConfig } from "../../app_config";

/**
 * The flow definition for `dir`. Keyed on the dir so navigation re-fetches,
 * and on the log root because the root is part of the data's identity. `api`
 * and `logDir` come from one config snapshot (the api instance is bound to
 * that dir at construction), so the key and the fetch can't pair values from
 * different roots. `staleTime: Infinity` because a dir's flow doesn't change
 * under a fixed root and dir.
 */
export const useFlowQuery = (dir: string): AsyncData<string | undefined> => {
  const { api, logDir } = useAppConfig();
  return useAsyncDataFromQuery({
    queryKey: ["flow", logDir, dir],
    // react-query errors on an `undefined` queryFn result ("data is
    // undefined"), so a missing flow must be *stored* as `null`; `select`
    // converts it back so `null` never leaks to consumers.
    queryFn: async () => (await api.get_flow(dir)) ?? null,
    select: (flow) => flow ?? undefined,
    staleTime: Infinity,
  });
};
