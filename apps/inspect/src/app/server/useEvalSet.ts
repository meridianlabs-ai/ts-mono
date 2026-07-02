import { EvalSet } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi, useLogDir } from "../../app_config";

/**
 * Resolve the eval-set for the current log dir. Keyed on the dir so a
 * navigation re-fetches; `staleTime: Infinity` because an eval-set's identity
 * doesn't change under a fixed dir.
 */
export const useEvalSet = (): AsyncData<EvalSet | undefined> => {
  const api = useApi();
  const logDir = useLogDir();
  return useAsyncDataFromQuery({
    queryKey: ["eval-set", logDir],
    // react-query errors on an `undefined` queryFn result ("data is
    // undefined"), so a missing eval-set must be *stored* as `null`; `select`
    // converts it back so `null` never leaks to consumers.
    queryFn: async () => (await api.get_eval_set(logDir)) ?? null,
    select: (evalSet) => evalSet ?? undefined,
    staleTime: Infinity,
  });
};
