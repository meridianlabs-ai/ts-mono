import { EvalSet } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { getAppConfig } from "../appConfig";

import { useLogDir } from "./useLogDir";

/**
 * Resolve the eval-set for the current log dir. Keyed on the dir so a
 * navigation re-fetches; `staleTime: Infinity` because an eval-set's identity
 * doesn't change under a fixed dir. Reads the api via the sanctioned non-react
 * accessor. The queryFn coalesces a missing eval-set to `null` — react-query
 * rejects an `undefined` query result.
 */
export const useEvalSet = (): AsyncData<EvalSet | null> => {
  const logDir = useLogDir();
  return useAsyncDataFromQuery({
    queryKey: ["eval-set", logDir],
    queryFn: async () =>
      (await getAppConfig().api.get_eval_set(logDir)) ?? null,
    staleTime: Infinity,
  });
};
