import { EvalSet } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useAppConfig } from "../../app_config";

/**
 * Resolve the eval-set for `dir`, a subdir RELATIVE to the log root ("" at
 * the listing root) — passing an absolute dir doubles the path server-side.
 * Keyed on the dir so navigation re-fetches, and on the log root because the
 * root is part of the data's identity. `api` and `logDir` come from one
 * config snapshot (the api instance is bound to that dir at construction),
 * so the key and the fetch can't pair values from different roots.
 * `staleTime: Infinity` because an eval-set's identity doesn't change under
 * a fixed root and dir.
 */
export const useEvalSet = (dir: string): AsyncData<EvalSet | undefined> => {
  const { api, logDir } = useAppConfig();
  return useAsyncDataFromQuery({
    queryKey: ["eval-set", logDir, dir],
    // react-query errors on an `undefined` queryFn result ("data is
    // undefined"), so a missing eval-set must be *stored* as `null`; `select`
    // converts it back so `null` never leaks to consumers.
    queryFn: async () => (await api.get_eval_set(dir)) ?? null,
    select: (evalSet) => evalSet ?? undefined,
    staleTime: Infinity,
  });
};
