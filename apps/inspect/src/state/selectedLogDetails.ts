import { AsyncData } from "@tsmono/util";

import { useLogDir } from "../app_config";
import { LogDetails } from "../client/api/types";
import { useLogDetailQuery } from "../log_data";

import { useStore } from "./store";

/** Selection binding: the selected log's details query — the fetch trigger
 *  and loading/error surface (see `useLogDetailQuery`). */
export const useSelectedLogQuery = (): AsyncData<LogDetails> =>
  useLogDetailQuery(
    useLogDir(),
    useStore((state) => state.logs.selectedLogFile)
  );

/** Whether the selected log's details are loading (false when nothing is
 *  selected — the query idles on `skipToken` then, which reads as pending). */
export const useSelectedLogLoading = (): boolean => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  return useSelectedLogQuery().loading && selectedLogFile !== undefined;
};
