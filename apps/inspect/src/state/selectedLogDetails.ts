import { useLogDir } from "../app_config";
import { LogDetails } from "../client/api/types";
import { LogDataState, useLogDetail } from "../log_data";

import { useStore } from "./store";

/** Selection binding: the selected log's details — the fetch trigger and
 *  loading/error surface (see `useLogDetail`). */
export const useSelectedLogDetail = (): LogDataState<LogDetails> =>
  useLogDetail(
    useLogDir(),
    useStore((state) => state.logs.selectedLogFile)
  );

/** Whether the selected log's details are loading. `LogDataState.loading` is
 *  already false when no file is selected. */
export const useSelectedLogLoading = (): boolean =>
  useSelectedLogDetail().loading;
